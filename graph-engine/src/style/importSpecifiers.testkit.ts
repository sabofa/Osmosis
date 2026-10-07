// Reading the modules a source file names, for the tests that guard what style/ may import
// (boundary.test.ts, and ../proseBoundary.test.ts).
//
// It reads the file as TypeScript and walks the syntax tree, so what it finds is what the
// compiler finds: it is not fooled by a comment, a string that looks like one ("//" or "/*" in a
// string), a template literal, or an import split over lines. It finds every way a file can name
// another module:
//
//   import ... from 'x'            import 'x'            import type ... from 'x'
//   export ... from 'x'            import x = require('x')
//   import('x')   import(`x`)      require('x')          typeof import('x')
//   import.meta.glob('./x/**')     import.meta.glob(['./a/*', './b/*'])   (and globEager)
//
// A test file only: nothing in the product imports it, and it imports the compiler.

import ts from 'typescript'

// What a source names. `glob` is a pattern from import.meta.glob (and a template's fixed start);
// `computed` is a specifier the reader cannot know (a variable): it cannot be checked, so a test
// that guards a boundary refuses it.
export interface Named {
  specifier: string
  kind: 'module' | 'glob' | 'computed'
}

const isImportMeta = (node: ts.Node): boolean => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword

export function namedBy(file: string, source: string): Named[] {
  const found: Named[] = []
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

  const add = (specifier: string, kind: Named['kind'] = 'module') => void found.push({ specifier, kind })

  // A string, or the fixed start of a template: a computed specifier with a fixed start is read as a
  // pattern, since the start says where it can reach.
  const addExpression = (expression: ts.Node | undefined, kind: Named['kind']) => {
    if (expression === undefined) return
    if (ts.isStringLiteralLike(expression)) add(expression.text, kind)
    else if (ts.isTemplateExpression(expression)) add(expression.head.text, 'glob')
    else if (ts.isArrayLiteralExpression(expression)) for (const element of expression.elements) addExpression(element, kind)
    else add(expression.getText(sourceFile), 'computed')
  }

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      addExpression(node.moduleSpecifier, 'module')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addExpression(node.moduleReference.expression, 'module')
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addExpression(node.argument.literal, 'module')
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        addExpression(node.arguments[0], 'module')
      } else if (ts.isPropertyAccessExpression(callee) && isImportMeta(callee.expression) && /^glob(Eager)?$/.test(callee.name.text)) {
        addExpression(node.arguments[0], 'glob')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

// A path from `file`'s folder, resolved to a path from src/ ("style/media/clean.ts" and "../space/x"
// give "space/x"; a path that leaves src/ keeps its leading ".."). `file` is a key of the style/ glob
// ("./media/clean.ts"). A specifier that is not relative (a package, an alias) comes back as it is.
export function fromSrc(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const parts = ['style', ...file.replace(/^\.\//, '').split('/').slice(0, -1)]
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
    } else parts.push(part)
  }
  return parts.join('/')
}

// The part of a glob before its first wildcard, cut back to a folder: where the pattern starts looking.
export function globRoot(pattern: string): string {
  const stop = pattern.search(/[*?{}[\]()!]/)
  const fixed = stop === -1 ? pattern : pattern.slice(0, stop)
  return fixed.endsWith('/') ? fixed : fixed.slice(0, fixed.lastIndexOf('/') + 1)
}
