// What the board settings mean in the picture: the constants that derive the
// blackboard, the greenboard and the whiteboard from a theme's accent colour
// (style/theme/derive.ts, deriveBoards).
//
// Today these are constants in deriveBoards, and nothing reads them from a
// settings layer yet: the registry describes them and their defaults, and wiring
// a layer through to them is the layer stack's job (Task 4).

import type { Meanings } from '../types'

export const BOARD_MEANINGS: Meanings = {
  'board.tilt': {
    meaning:
      "How far each board's hue (the slate of the blackboard, the green of the greenboard, the white of the whiteboard) leans toward the theme's accent colour, as a share of the angle between the two (0 to 1, default 0.5). The angle is first limited to 40 degrees, so at the default a board turns at most 20 degrees: a blackboard picks up a faint cast of the accent's colour. 0 keeps every board its own pure hue. The lean fades to nothing as the accent nears the board's opposite hue, and as the accent loses its colour, so a small change of accent never makes a board jump.",
    unit: '×',
    interactions: ['board.blackboard.chromaCap', 'board.greenboard.chromaCap', 'board.whiteboard.chromaCap'],
  },
  'board.blackboard.chromaCap': {
    meaning:
      "The most colour a blackboard may take from the accent, as OKLCH chroma (default 0.03). A fully coloured accent adds at most 0.012 to the slate's own 0.012, so at the default the cap is never reached; it only bites once set below about 0.024. Lower it to keep the board closer to neutral slate, and set 0 for a board with no colour at all.",
    unit: 'chroma',
    interactions: ['board.tilt'],
  },
  'board.greenboard.chromaCap': {
    meaning:
      "The most colour a greenboard may take from the accent, as OKLCH chroma (default 0.07). The green is already a strong colour (0.05) and a fully coloured accent adds at most 0.012, so at the default the cap is never reached; it only bites once set below about 0.062. Lower it to pull the green toward grey; set it under 0.05 and even the board's own green is reduced.",
    unit: 'chroma',
    interactions: ['board.tilt'],
  },
  'board.whiteboard.chromaCap': {
    meaning:
      "The most colour a whiteboard may take from the accent, as OKLCH chroma (default 0.012). A white board is almost neutral (0.004), and this cap does bite: a strongly coloured accent (chroma over about 0.1) is held to it, so the board stays a clean white with at most a faint cool or warm cast. Raise it for a visibly tinted board; set 0 for pure neutral white.",
    unit: 'chroma',
    interactions: ['board.tilt'],
  },
}
