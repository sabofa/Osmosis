// The data-component hooks the engine's chrome carries, so a workspace theme
// can restyle toolbars, menus and popovers inside the view. Values must come
// from the shell's published vocabulary (chromeComponents.test.ts).
export const CHROME_COMPONENTS = ['tool-row', 'pill', 'menu', 'menu-item', 'well'] as const
export type ChromeComponent = (typeof CHROME_COMPONENTS)[number]
