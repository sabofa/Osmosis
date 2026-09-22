// ----------------------------------------------------------------------------
// One command core, two front ends. A command runs against three small
// interfaces the host provides: `api` (an HTTP client to a node), `out`
// (where text goes) and `ui` (what only a screen can do). The app implements
// all three; the terminal implements api + out and a ui that prints
// fallbacks or points at the app.
// ----------------------------------------------------------------------------

export interface Api {
  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
  put<T = unknown>(path: string, body?: unknown): Promise<T>
  del<T = unknown>(path: string): Promise<T>
}

export interface Out {
  text(s: string): void
  table(rows: Record<string, unknown>[], columns?: string[]): void
  json(value: unknown): void
  error(s: string): void
}

export type Page = 'home' | 'bank' | 'library' | 'live' | 'results' | 'settings'

export interface NavigateParams {
  tag?: string
  template?: string
  session?: string
  results?: { tag?: string; date?: string }
}

// Everything a screen can do that a terminal cannot. Every method returns
// whether it happened, so a command can say "open the app for that" when it
// did not.
export interface Ui {
  navigate(page: Page, params?: NavigateParams): Promise<boolean>
  back(): Promise<boolean>
  showGraph(spec: string, caption?: string): Promise<boolean>
  showDocument(doc: { title: string; text: string } | { assetId: string }): Promise<boolean>
  showQuestion(questionId: string): Promise<boolean>
  startAttempt(attemptId: string): Promise<boolean>
  openThemeEditor(themeId?: string): Promise<boolean>
  setThemeMode(mode: 'light' | 'dark' | 'system'): Promise<boolean>
  // The shell itself: clear its output, restart it fresh, or reload the host.
  shell(action: 'clear' | 'restart' | 'reload'): Promise<boolean>
  confirm(message: string, typeToConfirm?: string): Promise<boolean>
  prompt(label: string, options?: { placeholder?: string; multiline?: boolean }): Promise<string | null>
  // Which surface this is; commands read it to phrase their fallbacks.
  surface: 'app' | 'terminal'
}

export interface CommandContext {
  api: Api
  out: Out
  ui: Ui
}

// Argument kinds drive completion. `word` completes nothing; the rest ask
// the node for candidates.
export type ArgKind =
  | 'word'
  | 'text'
  | 'page'
  | 'tag'
  | 'template'
  | 'question'
  | 'asset'
  | 'theme'
  | 'session'
  | 'setting'
  | 'date'
  | 'response'
  | 'attempt'
  | 'score'
  | 'daily-kind'
  | 'admin-scope'

export interface ArgSpec {
  name: string
  kind: ArgKind
  optional?: boolean
  // A rest argument swallows every remaining token (joined by spaces).
  rest?: boolean
  describe?: string
}

export interface Parsed {
  tokens: string[]
  flags: Record<string, string | true>
}

export interface CommandSpec {
  // The words that name the command, e.g. ['open', 'bank'].
  path: string[]
  args?: ArgSpec[]
  describe: string
  // Longer help, shown by `help <command>`.
  help?: string
  run(ctx: CommandContext, args: Record<string, string>, flags: Record<string, string | true>): Promise<void>
}

export interface Suggestion {
  // What replaces the token being completed.
  insert: string
  // What the list shows (may carry a hint beside the value).
  label: string
  hint?: string
  score: number
}

export interface Completion {
  // The token index the suggestions apply to.
  tokenIndex: number
  suggestions: Suggestion[]
}
