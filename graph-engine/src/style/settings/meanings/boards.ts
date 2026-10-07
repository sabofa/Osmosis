// What the board settings mean in the picture: the constants that derive the
// blackboard, the greenboard and the whiteboard from a theme's accent colour
// (style/theme/derive.ts, deriveBoards).
//
// Today these are constants in deriveBoards, and nothing reads them from a
// settings layer: the registry describes them and their defaults, and wiring a
// layer through to them is the layer stack's job (Task 4). Nothing draws a board
// yet either (the backgrounds are Task 6). So every meaning here opens with "Not
// drawn yet:" and says what the setting WILL do; the task that wires it removes the
// prefix, and the list in registry.test.ts with it.

import type { Meanings } from '../types'

export const BOARD_MEANINGS: Meanings = {
  'board.tilt': {
    meaning:
      "Not drawn yet: how far each board's hue will lean toward the theme's accent colour, as a share of the angle between the two. The angle is first limited to 40 degrees, so a board never turns more than that. 0 keeps every board its own pure hue; a blackboard picks up a faint cast of the accent's colour as the share grows. The lean fades to nothing as the accent nears the board's opposite hue, and as the accent loses its colour, so a small change of accent never makes a board jump. Today the lean is a fixed constant in the theme adapter and nothing reads it from a setting.",
    interactions: ['board.blackboard.chromaCap', 'board.greenboard.chromaCap', 'board.whiteboard.chromaCap'],
  },
  'board.blackboard.chromaCap': {
    meaning:
      "Not drawn yet: the most colour a blackboard will be allowed to take from the accent, as OKLCH chroma. The accent adds at most 0.012 to the slate's own 0.012, so a cap above about 0.024 is never reached and only a lower one bites. Lower it to keep the board closer to neutral slate, and set 0 for a board with no colour at all. Today the cap is a fixed constant in the theme adapter and nothing reads it from a setting.",
    interactions: ['board.tilt'],
  },
  'board.greenboard.chromaCap': {
    meaning:
      "Not drawn yet: the most colour a greenboard will be allowed to take from the accent, as OKLCH chroma. The green is already a strong colour (0.05) and the accent adds at most 0.012, so a cap above about 0.062 is never reached and only a lower one bites; set under 0.05 it reduces even the board's own green. Lower it to pull the green toward grey. Today the cap is a fixed constant in the theme adapter and nothing reads it from a setting.",
    interactions: ['board.tilt'],
  },
  'board.whiteboard.chromaCap': {
    meaning:
      "Not drawn yet: the most colour a whiteboard will be allowed to take from the accent, as OKLCH chroma. A white board is almost neutral (0.004) and the accent adds up to 0.012, so a cap below about 0.016 bites for a strongly coloured accent and holds the board to a clean white with at most a faint cool or warm cast. Raise it for a visibly tinted board; set 0 for pure neutral white. Today the cap is a fixed constant in the theme adapter and nothing reads it from a setting.",
    interactions: ['board.tilt'],
  },
}
