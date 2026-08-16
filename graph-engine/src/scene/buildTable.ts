import type { GraphConfig } from '../parser/config'
import { evalExpr, type FunctionTable } from '../parser/evalExpr'
import type { Statement } from '../parser/types'

export interface NamedTableData {
  name: string
  headers: string[]
  rows: string[][]
  // Set from a "table: y = f(x) for ..." generator statement's own source
  // text (see parser/parseStatement.ts) — null for a table built purely
  // from "header:"/"row:" lines, which has no single generating formula.
  formula: string | null
}

const GENERATOR_MAX_ROWS = 500

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return 'undefined'
  const rounded = Math.round(n * 10000) / 10000
  return String(rounded)
}

// Builds one NamedTableData per distinct table name used by "header:"/
// "row:"/"table:" statements (optionally prefixed "<name>.", see
// parser/types.ts's grammar comment) — unprefixed lines all belong to the
// same "" (default) table. Tables are returned in the order their name
// first appears in the spec, so a multi-table layout (see TableCanvas)
// stays stable across rebuilds. "@hide: <name>" (see parser/config.ts) drops
// a table from the result entirely. Any other statement kind is ignored: a
// spec authored for table mode isn't expected to also carry graph statements.
export function buildTable(statements: Statement[], config: GraphConfig): NamedTableData[] {
  const functions: FunctionTable = {}
  for (const statement of statements) {
    if (statement.kind === 'functionDef') functions[statement.name] = { param: statement.param, body: statement.body }
    else if (statement.kind === 'constantDef') functions[statement.name] = { param: null, body: statement.value }
  }

  const order: string[] = []
  const tables = new Map<string, NamedTableData>()
  function tableFor(name: string): NamedTableData | null {
    if (config.hidden.has(name)) return null
    let table = tables.get(name)
    if (!table) {
      table = { name, headers: [], rows: [], formula: null }
      tables.set(name, table)
      order.push(name)
    }
    return table
  }

  for (const statement of statements) {
    if (statement.kind === 'tableHeader') {
      const table = tableFor(statement.tableName)
      if (table && table.headers.length === 0) table.headers.push(...statement.cells)
      continue
    }
    if (statement.kind === 'tableRow') {
      const table = tableFor(statement.tableName)
      if (table) table.rows.push(statement.cells)
      continue
    }
    if (statement.kind === 'tableGenerator') {
      const table = tableFor(statement.tableName)
      if (!table) continue
      if (table.headers.length === 0) table.headers.push(statement.independent, statement.dependent)
      if (table.formula === null) table.formula = statement.formula
      const from = evalExpr(statement.from, {}, config.angle, functions)
      const to = evalExpr(statement.to, {}, config.angle, functions)
      const step = evalExpr(statement.step, {}, config.angle, functions)
      if (step <= 0) throw new Error('table step must be a positive number')
      let count = 0
      for (let x = from; x <= to + 1e-9 && count < GENERATOR_MAX_ROWS; x += step, count++) {
        let cell: string
        try {
          cell = formatNumber(evalExpr(statement.body, { [statement.independent]: x }, config.angle, functions))
        } catch {
          cell = 'undefined'
        }
        table.rows.push([formatNumber(x), cell])
      }
    }
  }

  return order.map((name) => tables.get(name)!)
}
