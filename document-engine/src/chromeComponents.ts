// The data-component hooks the engine's chrome carries, so a workspace theme
// can restyle toolbars, menus and popovers inside the view.
//
// SHELL_COMPONENTS come from the shell's published vocabulary
// (chromeComponents.test.ts). ENGINE_COMPONENTS are the engine's own names:
// they have flat engine-side fallbacks (ribbon/Ribbon.css, ViewerControls.css)
// and no shell styling yet, so the shell's generic pill / tool-row look cannot
// leak into them. The shell may theme them later.
export const SHELL_COMPONENTS = ['pill', 'menu', 'menu-item', 'well'] as const
export const ENGINE_COMPONENTS = [
  'ribbon', 'ribbon-tab', 'ribbon-group', 'ribbon-button', 'ribbon-select', 'ribbon-gallery', 'viewer-control',
] as const
export const CHROME_COMPONENTS = [...SHELL_COMPONENTS, ...ENGINE_COMPONENTS] as const
export type ChromeComponent = (typeof CHROME_COMPONENTS)[number]
