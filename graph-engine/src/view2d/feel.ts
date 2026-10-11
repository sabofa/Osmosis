// How a 2D view feels — every number that decides it, in one place.
//
// Handling is mostly tuning: how soon a zoom arrives, how long a flick
// carries, how far out is too far. Scattered through the code those numbers
// cannot be compared or changed together, and the flowchart and table engines
// would each grow their own. Here they are named and commented, so that Ben
// tunes the feel in one file and every engine on this model moves with it.

// Every number that decides how a 2D view feels, in one place. Times are in
// milliseconds, distances on screen in CSS pixels, zoom relative to the
// fitted view. Engines read these; Ben tunes them here.
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 64
// The least a view keeps of its content in each axis, as a fraction of the
// content frame (or half the screen, when zoomed in past that; see limits.ts).
export const PAN_MARGIN = 0.15
// Exponential approach for smoothed moves (wheel, keys): about 4τ to arrive.
export const SMOOTH_TAU = 70
// Coasting after a drag: the velocity of the last COAST_WINDOW ms carries on
// and decays with COAST_TAU; it stops below COAST_STOP px/s. A release after
// holding still for COAST_HOLD ms or more does not coast.
export const COAST_WINDOW = 80
export const COAST_TAU = 150
export const COAST_STOP = 20
export const COAST_HOLD = 80
// Reset and focus: an ease-out cubic over this long (the 3D engine's reset).
export const EASE_DURATION = 280
// Input.
export const WHEEL_SENSITIVITY = 0.0015 // per wheel pixel
export const PINCH_WHEEL_SENSITIVITY = 0.01 // ctrl + wheel: a trackpad pinch
export const WHEEL_LINE_PX = 16 // deltaMode 1
export const WHEEL_PAGE_PX = 400 // deltaMode 2
export const KEY_ZOOM_STEP = 1.25
export const KEY_PAN_FRACTION = 0.1
export const CLICK_SLOP = 4 // px: under this a press is a click
export const DOUBLE_CLICK_MS = 300
export const DOUBLE_CLICK_SLOP = 6
export const HOVER_TOLERANCE = 8 // px, mouse and pen
export const TOUCH_TOLERANCE = 16 // px, touch
// Below these the smoothed view counts as arrived and snaps.
export const ARRIVE_PX = 0.05
export const ARRIVE_LOG_ZOOM = 1e-4
