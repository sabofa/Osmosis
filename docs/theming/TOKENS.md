# Osmosis theme tokens

> Generated file — do not edit. Regenerate with `npm run docs --workspace=theme-core`.

Every token is a CSS custom property `--<name>`. There are two tiers: semantic tokens derive from the theme seeds and dials, and component tokens derive from semantic tokens. Any token can be overridden per mode in a theme manifest `overrides`. Defaults below are the resolved values of the built-in Osmosis theme.

## colour

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `color-canvas` | semantic | color | both | The page background behind everything; the lowest layer of the UI. | `#eef1e5` | `#17160f` |
| `color-surface` | semantic | color | both | Background of cards, panels, sidebars and inputs that sit on the canvas. | `#ffffff` | `#201e15` |
| `color-surface-raised` | semantic | color | both | Background of elements lifted above a surface: popovers, hovered cards, menus. | `#ffffff` | `#2c2a21` |
| `color-surface-sunken` | semantic | color | both | Background of recessed areas such as code blocks, wells and the track of a control. | `#e4e7db` | `#1e1d16` |
| `color-surface-overlay` | semantic | color | both | Background of floating layers: dialogs, command palettes, dropdowns. | `#ffffff` | `#2c2a21` |
| `color-scrim` | semantic | color | both | Translucent veil dimming the page behind a modal dialog. | `#17170f73` | `#f2efe273` |
| `color-text` | semantic | color | both | Primary text colour for body copy and headings. | `#17170f` | `#f2efe2` |
| `color-text-muted` | semantic | color | both | Secondary text: captions, descriptions, metadata. | `#6b6b5f` | `#a19d8c` |
| `color-text-faint` | semantic | color | both | Tertiary text: placeholders, disabled labels, timestamps. | `#9e9e9a` | `#68655a` |
| `color-text-on-accent` | semantic | color | both | Text and icons placed on a solid accent-coloured background such as a primary button. | `#000000` | `#181611` |
| `color-link` | semantic | color | both | Colour of inline hyperlinks. | `#c65d22` | `#e2803f` |
| `color-border` | semantic | color | both | Default hairline border around cards, inputs and tables. | `#e4e2d4` | `#34311e` |
| `color-border-strong` | semantic | color | both | Emphasised border: hovered inputs, selected outlines, separators that must stand out. | `#c9c6b3` | `#4a4530` |
| `color-divider` | semantic | color | both | Faint rule between rows or sections inside a single surface. | `#e8e8db` | `#282618` |
| `color-focus` | semantic | color | both | Keyboard focus ring; kept visible against the canvas. | `#c65d22` | `#e2803f` |
| `color-accent` | semantic | color | both | The brand/action colour: primary buttons, active tabs, key highlights. | `#c65d22` | `#e2803f` |
| `color-accent-hover` | semantic | color | both | Hover state of accent-coloured controls backgrounds. | `#b8510f` | `#f08d4c` |
| `color-accent-active` | semantic | color | both | Pressed state of accent-coloured controls backgrounds. | `#aa4500` | `#fe9959` |
| `color-accent-wash` | semantic | color | both | Very light tint of the accent colour for selected rows, badges and highlighted regions. | `#faf1e9` | `#2c2113` |
| `color-accent-text` | semantic | color | both | The accent colour adjusted to be readable as text on a surface (4.5:1). | `#c0571a` | `#e2803f` |
| `color-secondary` | semantic | color | both | Supporting colour for secondary actions and contrasting emphasis. | `#a17900` | `#bb9a29` |
| `color-secondary-hover` | semantic | color | both | Hover state of secondary-coloured controls backgrounds. | `#936e00` | `#c8a739` |
| `color-secondary-active` | semantic | color | both | Pressed state of secondary-coloured controls backgrounds. | `#856300` | `#d5b348` |
| `color-secondary-wash` | semantic | color | both | Very light tint of the secondary colour for selected rows, badges and highlighted regions. | `#e6e5d1` | `#2c2715` |
| `color-secondary-text` | semantic | color | both | The secondary colour adjusted to be readable as text on a surface (4.5:1). | `#967000` | `#bb9a29` |
| `color-good` | semantic | color | both | Status colour for success, correct answers and positive change. | `#4c7a4a` | `#6fa06c` |
| `color-good-wash` | semantic | color | both | Pale background tint for success, correct answers and positive change banners and badges. | `#dde5d5` | `#23281b` |
| `color-good-text` | semantic | color | both | The good colour adjusted to read as text on a surface (4.5:1). | `#4c7a4a` | `#6fa06c` |
| `color-bad` | semantic | color | both | Status colour for errors, wrong answers and destructive actions. | `#a34b3f` | `#c76a5c` |
| `color-bad-wash` | semantic | color | both | Pale background tint for errors, wrong answers and destructive actions banners and badges. | `#e8e0d3` | `#2e2219` |
| `color-bad-text` | semantic | color | both | The bad colour adjusted to read as text on a surface (4.5:1). | `#a34b3f` | `#c86b5d` |
| `color-warn` | semantic | color | both | Status colour for warnings and things needing attention. | `#a67600` | `#ca9200` |
| `color-warn-wash` | semantic | color | both | Pale background tint for warnings and things needing attention banners and badges. | `#e7e4d1` | `#2e2614` |
| `color-warn-text` | semantic | color | both | The warn colour adjusted to read as text on a surface (4.5:1). | `#9b6e00` | `#ca9200` |
| `color-info` | semantic | color | both | Status colour for neutral information and hints. | `#3d7fd8` | `#609ef5` |
| `color-info-wash` | semantic | color | both | Pale background tint for neutral information and hints banners and badges. | `#dce6e5` | `#22282c` |
| `color-info-text` | semantic | color | both | The info colour adjusted to read as text on a surface (4.5:1). | `#3476ce` | `#609ef5` |
| `color-series-1` | semantic | color | both | Categorical data colour 1 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#c06d44` | `#e08e5b` |
| `color-series-2` | semantic | color | both | Categorical data colour 2 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#009b8d` | `#1ebcb4` |
| `color-series-3` | semantic | color | both | Categorical data colour 3 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#a76db2` | `#cc89cc` |
| `color-series-4` | semantic | color | both | Categorical data colour 4 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#99861b` | `#b1a846` |
| `color-series-5` | semantic | color | both | Categorical data colour 5 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#2890c4` | `#58ade9` |
| `color-series-6` | semantic | color | both | Categorical data colour 6 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#c36571` | `#e68486` |
| `color-series-7` | semantic | color | both | Categorical data colour 7 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#489a60` | `#5dbb85` |
| `color-series-8` | semantic | color | both | Categorical data colour 8 of 8 for chart series, graph nodes and tags; all are legible on a surface. | `#8479ca` | `#a995e8` |
| `color-heat-0` | semantic | color | both | Heatmap / intensity ramp step 0 of 4, from the border colour (none) to the accent (most). | `#e4e2d4` | `#2a2819` |
| `color-heat-1` | semantic | color | both | Heatmap / intensity ramp step 1 of 4, from the border colour (none) to the accent (most). | `#e9c9a6` | `#4a3a20` |
| `color-heat-2` | semantic | color | both | Heatmap / intensity ramp step 2 of 4, from the border colour (none) to the accent (most). | `#e3a468` | `#7a4e24` |
| `color-heat-3` | semantic | color | both | Heatmap / intensity ramp step 3 of 4, from the border colour (none) to the accent (most). | `#d97a35` | `#a85f2a` |
| `color-heat-4` | semantic | color | both | Heatmap / intensity ramp step 4 of 4, from the border colour (none) to the accent (most). | `#c65d22` | `#e2803f` |
| `color-selection` | semantic | color | both | Background of selected text and selected ranges. | `#c65d2240` | `#e2803f40` |
| `color-highlight-1` | semantic | color | both | Marker-pen highlight 1 of 4 for annotating text (yellow, green, blue, pink families). | `#e4d596` | `#564700` |
| `color-highlight-2` | semantic | color | both | Marker-pen highlight 2 of 4 for annotating text (yellow, green, blue, pink families). | `#b4e3b2` | `#2a5329` |
| `color-highlight-3` | semantic | color | both | Marker-pen highlight 3 of 4 for annotating text (yellow, green, blue, pink families). | `#a8dcff` | `#154d6d` |
| `color-highlight-4` | semantic | color | both | Marker-pen highlight 4 of 4 for annotating text (yellow, green, blue, pink families). | `#fec0da` | `#67344c` |
| `color-shadow` | semantic | color | both | Colour of drop shadows; always translucent. | `#17170f2e` | `#f2efe280` |
| `color-syntax-keyword` | semantic | color | both | Code syntax colour for keyword tokens, readable on a surface. | `#7d5fad` | `#ba9cef` |
| `color-syntax-string` | semantic | color | both | Code syntax colour for string tokens, readable on a surface. | `#3e8343` | `#7bc27e` |
| `color-syntax-number` | semantic | color | both | Code syntax colour for number tokens, readable on a surface. | `#a65c20` | `#e89960` |
| `color-syntax-function` | semantic | color | both | Code syntax colour for function tokens, readable on a surface. | `#1479b0` | `#5fb8f2` |
| `color-syntax-type` | semantic | color | both | Code syntax colour for type tokens, readable on a surface. | `#00837e` | `#30c6bf` |
| `color-syntax-comment` | semantic | color | both | Code syntax colour for comments. | `#9e9e9a` | `#68655a` |
| `color-syntax-operator` | semantic | color | both | Code syntax colour for operators. | `#6b6b5f` | `#a19d8c` |
| `color-syntax-punctuation` | semantic | color | both | Code syntax colour for punctuation and brackets. | `#6b6b5f` | `#a19d8c` |

## type

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `font-display` | semantic | font | same | Font stack for large headings and titles. | `'Space Grotesk', system-ui, sans-serif` | `'Space Grotesk', system-ui, sans-serif` |
| `font-body` | semantic | font | same | Font stack for running text and most UI labels. | `'Inter', system-ui, sans-serif` | `'Inter', system-ui, sans-serif` |
| `font-mono` | semantic | font | same | Font stack for code, numbers in tables and technical readouts. | `ui-monospace, 'Cascadia Mono', Consolas, monospace` | `ui-monospace, 'Cascadia Mono', Consolas, monospace` |
| `font-math` | semantic | font | same | Font stack for typeset mathematics and equations. | `'STIX Two Text', 'STIX Two Math', Georgia, serif` | `'STIX Two Text', 'STIX Two Math', Georgia, serif` |
| `text-2xs` | semantic | length | same | Smallest text: dense badges and axis ticks. | `10px` | `10px` |
| `text-xs` | semantic | length | same | Fine print, captions and metadata. | `11.5px` | `11.5px` |
| `text-sm` | semantic | length | same | Compact UI text: table cells, secondary labels. | `13px` | `13px` |
| `text-md` | semantic | length | same | Base body and UI text size. | `14px` | `14px` |
| `text-lg` | semantic | length | same | Lead paragraphs and small headings (one scale step up). | `17px` | `17px` |
| `text-xl` | semantic | length | same | Section headings (two scale steps up). | `20px` | `20px` |
| `text-2xl` | semantic | length | same | Page headings (three scale steps up). | `24px` | `24px` |
| `text-3xl` | semantic | length | same | Display titles and hero text (four scale steps up). | `29px` | `29px` |
| `leading-tight` | semantic | number | same | Line height for headings and single-line labels. | `1.25` | `1.25` |
| `leading-normal` | semantic | number | same | Line height for body text. | `1.5` | `1.5` |
| `leading-loose` | semantic | number | same | Line height for long-form reading and relaxed layouts. | `1.75` | `1.75` |
| `weight-regular` | semantic | number | same | Font weight of normal text. | `400` | `400` |
| `weight-medium` | semantic | number | same | Font weight of emphasised labels and buttons. | `500` | `500` |
| `weight-bold` | semantic | number | same | Font weight of headings and strong emphasis. | `700` | `700` |

## shape

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `radius-xs` | semantic | length | same | Corner radius of the smallest elements: checkboxes, tags, inline code. | `3.5px` | `3.5px` |
| `radius-sm` | semantic | length | same | Corner radius of small controls: inputs, small buttons. | `7px` | `7px` |
| `radius-md` | semantic | length | same | Default corner radius of buttons, cards and panels. | `12px` | `12px` |
| `radius-lg` | semantic | length | same | Corner radius of large containers: dialogs, big cards. | `17px` | `17px` |
| `radius-xl` | semantic | length | same | Corner radius of the largest surfaces: sheets and hero panels. | `24px` | `24px` |
| `radius-pill` | semantic | length | same | Fully rounded ends for pills and toggles; square when roundness is 0. | `999px` | `999px` |
| `border-width` | semantic | length | same | Default border thickness; 0 when the theme wants borderless surfaces. | `1px` | `1px` |
| `border-width-strong` | semantic | length | same | Thickness of emphasised borders and focus outlines. | `2px` | `2px` |
| `corner-shape` | semantic | string | same | Corner geometry of panels and controls: round, squircle, bevel, notch, scoop or square. Consumed by components (var(--name) or component tokens); does not restyle anything by itself. Allowed: round | squircle | bevel | notch | scoop | square | `round` | `round` |
| `icon-sheet` | semantic | string | same | Which icon sheet the frame draws icons from: 'default' (the built-in line icons), 'builtin:<slug>' (a sprite shipped with the app) or 'asset:<hash>' (an uploaded sprite). The frame falls back to the default line icon for any icon name the sheet lacks. | `default` | `default` |

## space

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `space-1` | semantic | length | same | Spacing step 1 of 8 (1 base units, scaled by density) for padding, gaps and margins. | `4px` | `4px` |
| `space-2` | semantic | length | same | Spacing step 2 of 8 (2 base units, scaled by density) for padding, gaps and margins. | `8px` | `8px` |
| `space-3` | semantic | length | same | Spacing step 3 of 8 (3 base units, scaled by density) for padding, gaps and margins. | `12px` | `12px` |
| `space-4` | semantic | length | same | Spacing step 4 of 8 (4 base units, scaled by density) for padding, gaps and margins. | `16px` | `16px` |
| `space-5` | semantic | length | same | Spacing step 5 of 8 (6 base units, scaled by density) for padding, gaps and margins. | `24px` | `24px` |
| `space-6` | semantic | length | same | Spacing step 6 of 8 (8 base units, scaled by density) for padding, gaps and margins. | `32px` | `32px` |
| `space-7` | semantic | length | same | Spacing step 7 of 8 (12 base units, scaled by density) for padding, gaps and margins. | `48px` | `48px` |
| `space-8` | semantic | length | same | Spacing step 8 of 8 (16 base units, scaled by density) for padding, gaps and margins. | `64px` | `64px` |

## elevation

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `shadow-1` | semantic | shadow | both | Drop shadow at elevation level 1 of 3, for cards and raised controls; 'none' when elevation is 0. | `0 1px 5px #17170f2e, 0 0.5px 2.5px #17170f17` | `0 1px 5px #f2efe280, 0 0.5px 2.5px #f2efe240` |
| `shadow-2` | semantic | shadow | both | Drop shadow at elevation level 2 of 3, for popovers and menus; 'none' when elevation is 0. | `0 2px 8px #17170f2e, 0 1px 4px #17170f17` | `0 2px 8px #f2efe280, 0 1px 4px #f2efe240` |
| `shadow-3` | semantic | shadow | both | Drop shadow at elevation level 3 of 3, for dialogs and floating panels; 'none' when elevation is 0. | `0 3px 11px #17170f2e, 0 1.5px 5.5px #17170f17` | `0 3px 11px #f2efe280, 0 1.5px 5.5px #f2efe240` |
| `elevation-mode` | semantic | string | same | How raised surfaces are drawn: shadow, tonal (lighter fill), hairline, bevel, hard-offset or none. Consumed by components (var(--name) or component tokens); does not restyle anything by itself. Allowed: shadow | tonal | hairline | bevel | hard-offset | none | `shadow` | `shadow` |
| `bevel-light` | semantic | color | both | Highlight edge colour for bevelled surfaces (top/left lip). Consumed by components (var(--name) or component tokens); does not restyle anything by itself. | `#ffffff` | `#504f47` |
| `bevel-dark` | semantic | color | both | Shadow edge colour for bevelled surfaces (bottom/right lip). Consumed by components (var(--name) or component tokens); does not restyle anything by itself. | `#6f6e63` | `#030302` |
| `bevel-depth` | semantic | length | same | Thickness of the bevel lips when elevation-mode is bevel. Consumed by components (var(--name) or component tokens); does not restyle anything by itself. | `2px` | `2px` |

## motion

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `motion-fast` | semantic | duration | same | Duration of micro-interactions: hovers, presses, toggles. | `120ms` | `120ms` |
| `motion-normal` | semantic | duration | same | Duration of standard transitions: menus, tabs, panels. | `200ms` | `200ms` |
| `motion-slow` | semantic | duration | same | Duration of large transitions: page changes, dialogs. | `360ms` | `360ms` |
| `ease-standard` | semantic | easing | same | Easing curve for ordinary transitions. | `cubic-bezier(0.2, 0, 0, 1)` | `cubic-bezier(0.2, 0, 0, 1)` |
| `ease-emphasis` | semantic | easing | same | Easing curve for attention-drawing entrances that settle slowly. | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| `motion-style` | semantic | string | same | Character of motion: smooth, stepped, none or wiggle. Consumed by components (var(--name) or component tokens); does not restyle anything by itself. Allowed: smooth | stepped | none | wiggle | `smooth` | `smooth` |

## surface

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `surface-alpha` | semantic | number | same | Opacity of translucent surfaces (1 is solid); falls as the theme gets glassier. | `1` | `1` |
| `surface-blur` | semantic | length | same | Backdrop blur behind translucent surfaces; 0 for solid themes. | `0px` | `0px` |

## graph

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `graph-paper` | semantic | color | both | Background of the graph plane (the "paper" the curves are drawn on). | `#ffffff` | `#201e15` |
| `graph-ink` | semantic | color | both | Colour of graph labels, tick text and default curve strokes. | `#17170f` | `#f2efe2` |
| `graph-grid` | semantic | color | both | Minor gridlines of the graph plane. | `#e4e2d4` | `#34311e` |
| `graph-grid-strong` | semantic | color | both | Major gridlines and tick marks of the graph plane. | `#c9c6b3` | `#4a4530` |
| `graph-axis` | semantic | color | both | The x and y axes; a little softer than the ink. | `#484942` | `#b8b5a9` |
| `graph-segment` | semantic | color | both | Colour of drawn segments, rays and constructions marked as correct or given. | `#4c7a4a` | `#6fa06c` |
| `graph-point` | semantic | color | both | Colour of plotted points the learner must notice or answer with. | `#a34b3f` | `#c76a5c` |
| `graph-hover` | semantic | color | both | Highlight colour for the curve or point under the pointer. | `#c65d22` | `#e2803f` |
| `graph-marker-x-intercept` | semantic | color | both | Marker colour for x intercept features on a graph (data colour 1). | `#c06d44` | `#e08e5b` |
| `graph-marker-y-intercept` | semantic | color | both | Marker colour for y intercept features on a graph (data colour 2). | `#009b8d` | `#1ebcb4` |
| `graph-marker-local-max` | semantic | color | both | Marker colour for local max features on a graph (data colour 3). | `#a76db2` | `#cc89cc` |
| `graph-marker-local-min` | semantic | color | both | Marker colour for local min features on a graph (data colour 4). | `#99861b` | `#b1a846` |
| `graph-marker-inflection` | semantic | color | both | Marker colour for inflection features on a graph (data colour 5). | `#2890c4` | `#58ade9` |
| `graph-marker-center` | semantic | color | both | Marker colour for center features on a graph (data colour 6). | `#c36571` | `#e68486` |
| `graph-marker-focus` | semantic | color | both | Marker colour for focus features on a graph (data colour 7). | `#489a60` | `#5dbb85` |
| `graph-marker-conic-vertex` | semantic | color | both | Marker colour for conic vertex features on a graph (data colour 8). | `#8479ca` | `#a995e8` |
| `graph-marker-intersection` | semantic | color | both | Marker colour for intersection features on a graph (data colour 1). | `#c06d44` | `#e08e5b` |
| `graph-region-alpha` | semantic | number | same | Opacity of shaded regions (inequalities, areas under curves). | `0.18` | `0.18` |

## document

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `doc-page` | semantic | color | both | Background of the document page. | `#ffffff` | `#201e15` |
| `doc-text` | semantic | color | both | Body text colour inside documents. | `#17170f` | `#f2efe2` |
| `doc-rule` | semantic | color | both | Horizontal rules and table borders inside documents. | `#e4e2d4` | `#34311e` |
| `doc-code-bg` | semantic | color | both | Background of code blocks and inline code in documents. | `#e4e7db` | `#1e1d16` |
| `doc-code-text` | semantic | color | both | Text colour of code in documents. | `#17170f` | `#f2efe2` |
| `doc-table-header` | semantic | color | both | Background of table header rows in documents. | `#e4e7db` | `#1e1d16` |
| `doc-table-stripe` | semantic | color | both | Background of alternate (striped) table rows in documents. | `#f7f7f7` | `#25231a` |
| `doc-measure` | semantic | length | same | Maximum line length of document text, for comfortable reading. | `68ch` | `68ch` |
| `doc-font-body` | semantic | font | same | Font stack for document body text. Defaults to the UI body font; the document engine's reading themes override it without touching UI fonts. | `'Inter', system-ui, sans-serif` | `'Inter', system-ui, sans-serif` |

## component

| token | tier | type | modes | meaning | light default | dark default |
| --- | --- | --- | --- | --- | --- | --- |
| `sidebar-bg` | component | color | both | Background of the sidebar. | `#ffffff` | `#201e15` |
| `sidebar-border` | component | color | both | Border line between the sidebar and the content. | `#e4e2d4` | `#34311e` |
| `sidebar-row-active-bg` | component | color | both | Background of the selected sidebar row. | `#faf1e9` | `#2c2113` |
| `sidebar-row-active-text` | component | color | both | Text colour of the selected sidebar row. | `#c0571a` | `#e2803f` |
| `tab-bg` | component | color | both | Background of inactive tabs and the tab strip. | `#eef1e5` | `#17160f` |
| `tab-text` | component | color | both | Text colour of inactive tabs. | `#6b6b5f` | `#a19d8c` |
| `tab-active-bg` | component | color | both | Background of the active tab. | `#ffffff` | `#201e15` |
| `tab-active-text` | component | color | both | Text colour of the active tab. | `#17170f` | `#f2efe2` |
| `tab-border` | component | color | both | Border line of tabs and the tab strip. | `#e4e2d4` | `#34311e` |
| `panel-bg` | component | color | both | Background of panels and docked regions. | `#ffffff` | `#201e15` |
| `panel-border` | component | color | both | Border line around panels. | `#e4e2d4` | `#34311e` |
| `card-bg` | component | color | both | Background of cards. | `#ffffff` | `#2c2a21` |
| `card-border` | component | color | both | Border line around cards. | `#e4e2d4` | `#34311e` |
| `input-bg` | component | color | both | Background of text inputs and fields. | `#ffffff` | `#201e15` |
| `input-border` | component | color | both | Border of text inputs and fields at rest. | `#c9c6b3` | `#4a4530` |
| `input-border-focus` | component | color | both | Border of a focused input. | `#c65d22` | `#e2803f` |
| `input-text` | component | color | both | Text colour inside inputs. | `#17170f` | `#f2efe2` |
| `input-placeholder` | component | color | both | Placeholder text colour inside inputs. | `#9e9e9a` | `#68655a` |
| `button-primary-bg` | component | color | both | Background of primary buttons. | `#c65d22` | `#e2803f` |
| `button-primary-hover-bg` | component | color | both | Background of primary buttons on hover. | `#b8510f` | `#f08d4c` |
| `button-primary-text` | component | color | both | Label colour of primary buttons. | `#000000` | `#181611` |
| `button-secondary-bg` | component | color | both | Background of secondary buttons. | `#ffffff` | `#201e15` |
| `button-secondary-hover-bg` | component | color | both | Background of secondary buttons on hover. | `#e4e7db` | `#1e1d16` |
| `button-secondary-text` | component | color | both | Label colour of secondary buttons. | `#17170f` | `#f2efe2` |
| `button-secondary-border` | component | color | both | Border of secondary buttons. | `#c9c6b3` | `#4a4530` |
| `chip-bg` | component | color | both | Background of chips and tags. | `#faf1e9` | `#2c2113` |
| `chip-text` | component | color | both | Text colour of chips and tags. | `#c0571a` | `#e2803f` |
| `menu-bg` | component | color | both | Background of dropdown and context menus. | `#ffffff` | `#2c2a21` |
| `menu-border` | component | color | both | Border of dropdown and context menus. | `#e4e2d4` | `#34311e` |
| `menu-hover` | component | color | both | Background of a hovered menu item. | `#e4e7db` | `#1e1d16` |
| `modal-bg` | component | color | both | Background of modal dialogs. | `#ffffff` | `#2c2a21` |
| `modal-scrim` | component | color | both | Dimming layer behind modal dialogs. | `#17170f73` | `#f2efe273` |
| `code-bg` | component | color | both | Background of code blocks and inline code. | `#e4e7db` | `#1e1d16` |
| `code-text` | component | color | both | Text colour of code. | `#17170f` | `#f2efe2` |
| `code-border` | component | color | both | Border around code blocks. | `#e4e2d4` | `#34311e` |
| `table-header-bg` | component | color | both | Background of table header rows. | `#e4e7db` | `#1e1d16` |
| `table-stripe-bg` | component | color | both | Background of alternate table rows. | `#f7f7f7` | `#25231a` |
| `table-border` | component | color | both | Border lines of tables. | `#e4e2d4` | `#34311e` |
| `toast-bg` | component | color | both | Background of toast notifications (inverted against the page). | `#17170f` | `#f2efe2` |
| `toast-text` | component | color | both | Text colour of toast notifications. | `#eef1e5` | `#17160f` |
| `badge-good-bg` | component | color | both | Background of success badges. | `#dde5d5` | `#23281b` |
| `badge-bad-bg` | component | color | both | Background of error badges. | `#e8e0d3` | `#2e2219` |
| `sidebar-row-hover` | component | color | both | Background of a hovered sidebar row (surface nudged toward the accent). | `#fdf5f2` | `#2a2318` |
| `panel-shadow` | component | shadow | both | Shadow under panels. | `0 1px 5px #17170f2e, 0 0.5px 2.5px #17170f17` | `0 1px 5px #f2efe280, 0 0.5px 2.5px #f2efe240` |
| `card-shadow` | component | shadow | both | Shadow under cards. | `0 1px 5px #17170f2e, 0 0.5px 2.5px #17170f17` | `0 1px 5px #f2efe280, 0 0.5px 2.5px #f2efe240` |
| `menu-shadow` | component | shadow | both | Shadow under dropdown and context menus. | `0 3px 11px #17170f2e, 0 1.5px 5.5px #17170f17` | `0 3px 11px #f2efe280, 0 1.5px 5.5px #f2efe240` |
| `modal-shadow` | component | shadow | both | Shadow under modal dialogs. | `0 3px 11px #17170f2e, 0 1.5px 5.5px #17170f17` | `0 3px 11px #f2efe280, 0 1.5px 5.5px #f2efe240` |
| `panel-radius` | component | length | same | Corner radius of panels. | `17px` | `17px` |
| `card-radius` | component | length | same | Corner radius of cards. | `17px` | `17px` |
| `input-radius` | component | length | same | Corner radius of inputs. | `12px` | `12px` |
| `button-radius` | component | length | same | Corner radius of buttons. | `12px` | `12px` |
| `chip-radius` | component | length | same | Corner radius of chips and tags. | `999px` | `999px` |
| `menu-radius` | component | length | same | Corner radius of menus. | `12px` | `12px` |
| `modal-radius` | component | length | same | Corner radius of modal dialogs. | `24px` | `24px` |

## Old names (aliases)

| old | new |
| --- | --- |
| `--bg` | `--color-canvas` |
| `--surface` | `--color-surface` |
| `--ink` | `--color-text` |
| `--muted` | `--color-text-muted` |
| `--line` | `--color-border` |
| `--line-strong` | `--color-border-strong` |
| `--accent` | `--color-accent` |
| `--accent-wash` | `--color-accent-wash` |
| `--good` | `--color-good` |
| `--bad` | `--color-bad` |
| `--danger` | `--color-bad` |
| `--heat-0` | `--color-heat-0` |
| `--heat-1` | `--color-heat-1` |
| `--heat-2` | `--color-heat-2` |
| `--heat-3` | `--color-heat-3` |
| `--heat-4` | `--color-heat-4` |
