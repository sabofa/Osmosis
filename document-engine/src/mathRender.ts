import katex from 'katex'

// KaTeX's stylesheet (katex/dist/katex.min.css) is imported by the HOST app
// (web/src/main.tsx), not here — the engine ships no CSS import for it.

export type MathRender = { html: string } | { error: string }

// Pure and never throws: invalid TeX is rendered by KaTeX in its error colour
// (throwOnError:false); a hard failure comes back as {error}.
export function renderMath(tex: string, displayMode: boolean): MathRender {
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: false,
    })
    return { html }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
