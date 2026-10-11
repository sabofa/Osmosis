# Document Engine v2

Date: 2026-09-22

## Context

`document-engine` renders PDFs, images and markdown for one purpose: showing a
learner the passage a test question is about. Its two modes are named `simple`
and `full`, but `full` is really *test mode* — question markers, jump-to-question
callbacks, author-set anchors, marker-offset validation. Everything it does is
shaped around test-taking, with every other use a degenerate case.

Osmosis is becoming a workspace, where research documents, plans, notes and
spreadsheets are authored and edited rather than only read under exam
conditions. That inverts the engine's priorities: reading your own document is
now the common case and taking a test is the special one. It also adds three
things the engine has never had — **editing**, **spreadsheets**, and
**executable code**.

This is the document-engine half of the v2 work. Its sibling is
`2026-09-21-graph-engine-v2-design.md`, which owns the shared document format;
this spec references that format rather than redefining it.

## Relationship to the graph-engine spec

The graph spec establishes a multi-page document: an ordered list of pages, each
with a kind (`plot | space | figure | flow | text | sheet`), a source, an overlay
layer and a saved view, over a document-level binding and resource table.

Two consequences land here:

- **This engine renders `text`, `sheet` and `code` pages.** The two engines stop
  being separate products and become renderers behind one format.
- **A page is a unit of information, not of length.** There is no pagination;
  pages never break by word count. One page is one graph, one 5,000-word
  document, one sheet or one program. The rule is stated in full in the graph
  spec's format section.
- **The format's home is the graph spec's "The document model" section.**
  Changes to pages, bindings, resources, the container or addressing belong
  there. This document specifies the engine, not the file.

The text-encoding standard and file classification below are cross-cutting and
are mirrored into the graph spec, since both engines must obey them.

## Milestones

Five tracks, ordered by dependency rather than by appetite.

| Track | Subject | Why here |
|---|---|---|
| D1 | Viewer strip-down, the mode matrix, the text-encoding standard | The encoding and offset rules must be settled before anything writes text, and the viewer/test separation before anything is layered on it |
| D2 | The markdown editor | Depends on D1's anchor discipline: editing is what breaks offsets |
| D3 | The spreadsheet page | Independent of D2, but the editor's table UI shares its interaction model |
| D4 | Code pages and execution | Depends on D3 — reading a sheet is the feature that makes code pages worth having |
| D5 | UI overhaul and polish | Last, so it polishes a finished surface rather than a moving one |

D1 is not optional groundwork that can be skipped for speed. Everything in D2
through D4 writes, edits or annotates text, and every one of those operations
is wrong in a way that is invisible until it isn't, if the offset rules are not
pinned first.

### Position in the overall build order

Revised 2026-09-22. The full interleaved order lives in the graph-engine spec's
"Build order" section; these tracks sit in it as follows:

- **D1-D3 run together at step 4**, after the graph engine's Milestone A and
  after graph theme tokens are settled at step 3 — D5 must share those tokens,
  so they are a contract D1-D3 build against rather than something invented
  later.
- **D4 detaches and moves to step 8**, alongside the diagram engine and the
  live tutor layer. That suits it: code pages want the diagram engine for
  call-graph and data-structure rendering, and the live layer for tutor-driven
  stepping.
- **D5 pairs with graph track 5 at step 9**, as a single pass. A plot, a sheet
  and a page of prose in one document have to read as one object, which two
  passes months apart will not achieve.

**One consequence to go in with eyes open:** D3 lands at step 4, but the
multi-page container lands at step 7. The spreadsheet's defining feature is
that other pages read from it (`scatter from Data!A2:B40`), and cross-page
references need multi-page documents. So D3 builds the grid, formula engine,
dependency recalculation and CSV import against a single-page document, and
the thing it exists for cannot be exercised for three more steps — unless a
minimal cross-page reference is pulled forward with it.

## The mode matrix

`simple`/`full` is replaced by two axes rather than a flat list of modes:

|  | **view** | **annotate** | **edit** |
|---|---|---|---|
| **prose** | simple reading | reading with highlights and notes | the markdown editor |
| **sheet** | data view | annotated data | sheet editing |

Six cells from two renderers times three interaction levels, rather than six
independent code paths. The previously-unnamed cell — annotating a data table —
comes nearly free rather than being a mode nobody specified.

**Test scaffolding is an independent flag, not a mode.** See the next section.

## Principle: the viewer is a viewer

The single most important structural change in this spec.

- **The viewer renders, navigates and selects.** Zoom, theme, search, outline,
  text selection, personal highlights. It has no knowledge that questions exist.
- **Test features compose over it** — author-set anchors, question markers,
  jump-to-question, exposure events, the gated/collapsed state. A layer, not a
  mode.
- **The viewer never emits evidence.** It emits selection and exposure events
  and nothing else; what those mean is decided above it. Viewing writes
  exposure (`seen`, `dwell_ms`), never a response. A clicked marker or selected
  node is an exposure event unless something above explicitly asked a question.
- **The gated state is a render state.** An exposure-limited page must be able
  to collapse into an unreadable state and reopen when its gating outcome is
  recorded.

The practical test for whether this boundary holds: the viewer should be usable,
complete and pleasant in a workspace where no question, session or attempt
exists at all.

## Text encoding standard

Not a feature — a standard both engines obey. Beyond-ASCII support is a hard
requirement: Greek letters, the full mathematical operator set, and Japanese.

### Unicode carries characters; typesetting carries structure

These are two mechanisms and both are required.

**Unicode** covers symbols in prose: Greek (α β γ δ θ λ μ π σ φ ω), operators
(∫ ∑ ∏ ∂ ∇ √ ≤ ≥ ≠ ≈ ∈ ∉ ⊂ ∪ ∩ ∞ ±), arrows, set and logic notation. These are
real characters — typeable, storable, searchable, pasteable.

**Unicode cannot express raised structure in general.** It has some superscripts
(⁰¹²³⁴⁵⁶⁷⁸⁹ ⁿ ⁱ) and some subscripts (₀–₉ ₐ ₑ ₙ ₓ), but both sets are
incomplete and inconsistent — most letters have no superscript form. `x²`
works as a character; `x^(n+1)` rendered with the exponent genuinely raised does
not exist as characters at all. That requires math typesetting.

**KaTeX is the typesetting layer**, inline `$…$` and block `$$…$$`. Unicode for
symbols in running prose, KaTeX for mathematical structure. Neither substitutes
for the other.

### Encoding and offset rules

The current anchoring model — highlights, markers and excerpt ranges as
character offsets into `extractedText` — is safe while text is ASCII and
silently wrong once it is not:

- **Offset units are unspecified.** A JavaScript string indexes in UTF-16 code
  units; a byte offset from PDF extraction, a codepoint index from another
  language's tooling, and a grapheme-cluster index used for selection are three
  different numbers for the same position. With ASCII they coincide, which is
  why this has never surfaced.
- **Normalization drift.** A precomposed character and its combining-sequence
  equivalent look identical and have different lengths. Every offset after the
  difference shifts.

The rules, stated so they can be enforced:

1. **All text is UTF-8.**
2. **All text is normalized to NFC** on ingest and on save.
3. **All offsets are Unicode codepoint indices**, converted at component
   boundaries rather than each component using its language's native indexing.
4. **Anchors carry their quoted text** alongside their offsets (see Anchor
   stability), so an anchor can re-find itself if an offset convention was
   violated anywhere.

### Input

Symbols nobody can type are symbols nobody uses. Three input paths:

- A **symbol palette** organized by category (Greek, operators, relations, sets,
  arrows).
- **LaTeX-style autocomplete** in the editor: `\alpha` → α, `\int` → ∫,
  `\leq` → ≤. Also the discovery mechanism, since the names are already known.
- **Compose shortcuts** for the highest-frequency symbols.

### Fonts

No single face covers this, so the stack is deliberate and specified as a
fallback chain: a text face with genuine Greek coverage, a math face for
operators (STIX Two or Latin Modern Math), and a CJK face (Noto Sans/Serif JP).
A document mixing English prose, Greek variables and Japanese notes must not
render in three mismatched weights.

## Writing modes

A per-document setting with three values:

| Setting | Behavior |
|---|---|
| `western` (default) | Horizontal, left-to-right, top-to-bottom. Chosen automatically when the setting is absent |
| `japanese-horizontal` | Yokogaki — horizontal, with Japanese typography: CJK font stack, kinsoku line-breaking rules, optional ruby |
| `japanese-vertical` | Tategaki — `writing-mode: vertical-rl`, text top-to-bottom in columns running right-to-left |

Vertical is not a toggle; it inverts the layout model. Scroll direction flips,
the toolbar and outline panel need their own placement rules, embedded figures
and tables need block-level placement decisions, and selection geometry changes.
It is specified as a first-class mode for that reason rather than as a CSS flag.

### IME composition is a named technical risk

Typing Japanese goes through an input method that holds a *composing* state:
provisional text being converted before commit. Live-preview editors are exactly
where this breaks, because re-rendering decorations mid-composition can cancel
or corrupt the composition.

**The live-preview decoration layer must explicitly suspend while a composition
is active** and resume on commit. CodeMirror 6 exposes composition state for
this. Planned in, this is straightforward; retrofitted, it is painful.

## Anchor stability under editing

Editable text breaks offset-based anchoring: insert a word in the first
paragraph and every highlight below it silently slides.

Two layers, both required:

1. **Position mapping on live edits.** When an edit is applied, every anchor is
   remapped through the same diff in the same transaction. Correct while the
   document is open.
2. **Content-addressed anchors as the durable form.** An anchor stores its
   quoted text and surrounding context alongside its offset, so it can re-find
   itself by matching rather than by counting. This is what survives a
   save/reload cycle, a re-extraction, or an offset-convention violation.

Anchors must carry quoted text **from the start**, before editing ships. Cheap
now; a data migration later.

## The editor

### Foundation

**CodeMirror 6.** A fully fledged markdown editor needs syntax-aware editing,
decorations, multi-cursor, find/replace and folding — all of which CM6 provides
as a base. Decisively, it supports **in-place decorations**, which is what makes
live preview a build rather than a research project, and it handles IME
composition correctly. ProseMirror is document-model-first and fights raw
markdown; Monaco is code-shaped and poor at prose.

### Live preview

One pane. Markdown renders in place; the raw source is revealed on the line the
cursor occupies. This is the target directly rather than via a split-pane
intermediate.

The decoration layer is the hard part and the place where IME, undo granularity
and selection geometry all interact. It is also the *only* part that differs
from a split-pane editor — parser, commands, and document state are shared — so
a split-pane fallback remains available if a construct proves hostile to
in-place rendering.

### Editing fundamentals

Markdown syntax highlighting; auto-continuation of lists, task lists and
quotes; smart list indent and outdent; auto-pairing; multi-cursor; find and
replace with regex; line move, duplicate and delete; soft wrap at a real
reading measure; keyboard shortcuts for bold, italic, link and code.

### Markdown surface

GFM tables, task lists, strikethrough and footnotes; **KaTeX** inline and
block; fenced code blocks with syntax highlighting; callouts (`> [!note]`);
clipboard image paste landing as a document resource.

**A table editor.** Hand-aligning markdown tables is miserable enough to
suppress their use. A small in-place grid that writes back valid markdown is a
disproportionate quality-of-life gain, and it shares its interaction model with
the sheet page rather than being a one-off widget.

### Workspace-aware features

- **Wikilinks** `[[other-doc]]` with autocomplete, over the addressing scheme
  the format reserves.
- **Backlinks panel** — what links here.
- **Page embedding** — `![[graph-doc#page2]]` renders that page inline. A
  research document containing a live graph, not a screenshot of one. This is
  what makes the editor part of the engine rather than adjacent to it.
- **Outline panel** with jump-to-heading.
- **Search**, in-document and across the workspace.
- **Frontmatter** for the user-set kind tag and metadata.

### Math and research affordances

- **Math snippets and symbol autocomplete** (see Input above).
- **Inline data references** — pull a cell or range from a sheet page into
  prose, so a number in a writeup updates when its data does. The text-page
  counterpart of a graph reading from a sheet.

### Editor quality

Autosave with version snapshots; undo that survives the session; word count;
focus and typewriter modes; split view for two documents; export to PDF.

## The spreadsheet

### Framing

Not a spreadsheet application — **the data page of the document**, whose
defining property is that other pages read from it:

```
# on a graph page
scatter from Data!A2:B40
surface from Vol!B2:Z50
@param r = Assumptions!B3
```

Data, chart and explanation in one file, with the chart updating when the data
does. A sheet page is another way of providing a resource to the document.

Two structural connections:

- **A sensitivity table and a parameter sweep are the same operation.** Varying
  an input and tabulating the output is the graph spec's binding sweep rendered
  as a grid instead of as motion. One definition, two presentations.
- **The formula language already half-exists.** `graph-engine/src/parser/parseExpr.ts`
  and `evalExpr.ts` already handle precedence, implicit multiplication, function
  calls, named constants and user-defined functions. A formula language is that
  parser plus cell references and range functions — which means `=SUM(A1:A10)`
  and `y = sin(x)` share one grammar, and a graph can reference a cell with no
  translation layer.

### Scope

Built in-house. Libraries (Handsontable, AG Grid, univer) would render a grid
sooner but own the formula engine, fight the design system, carry commercial
licensing terms, and — decisively — cannot integrate with document parameters
and graph pages, which is the entire reason this page kind exists.

Scale is the constraint that isn't: a dataset, a lattice, a numerical-method
table. Hundreds to a few thousand cells, not a million. That removes the single
most expensive requirement real spreadsheets carry.

### The formula engine

In order of difficulty: **dependency graph and recalculation** (topological
ordering, incremental recalc, cycle detection), then **reference semantics**,
then editing interaction, then rendering.

Reference semantics are in scope in full — **relative and absolute references
(`A1`, `$A$1`), ranges (`A1:B10`), cross-page references (`Sheet!A1`), and
fill-down**. These are table stakes, not advanced features, and they are what
make lattices and iterative methods work: a binomial tree and Euler's method are
both "a cell referencing the cell above and to the left, filled across a range."

**The cell value type permits a block from day one**, even though nothing
produces one yet. Array/spill formulas are deferred, but accommodating them in
the value model now is free, and retrofitting them is not. Matrix operations are
gated on exactly this.

### Feature set

- **Named ranges**, referenced from graph pages and from document parameters
- **Typed columns** (number, date, text, category)
- **CSV/TSV import and paste**
- **Cells as document parameters, bidirectionally** — a slider drives a cell, or
  a cell is the parameter
- **Statistics**: MEAN, MEDIAN, STDEV, VAR, CORREL, COVAR, QUANTILE, NORM.DIST,
  NORM.INV
- **Regression**: SLOPE, INTERCEPT, RSQ — sharing the regression code the 2D
  graph engine already runs for scatter statements
- **Seeded randomness** — RAND and NORMSINV against a **per-document seed**.
  Volatile randomness makes a saved document irreproducible, which is
  unacceptable when the document is a durable artifact. Seeded by default
- **Conditional formatting and heatmap fills**, reusing the colormap work from
  the graph spec's track 3
- **Sparklines** in cells
- Frozen headers, sort, filter
- **Cell annotations**, using the document's overlay model

### Deferred

Array/spill formulas, matrix operations (MMULT, TRANSPOSE, MINVERSE, DET),
goal-seek/solver, explicit sensitivity-table UI, and the formula-audit
dependency view. The last of these becomes nearly free once the diagram engine
exists, since a precedent graph is a DAG.

## Code pages

A `code` page holds an executable program. It is a page kind like any other,
which means it sits in the same file as the prose explaining it, the sheet
feeding it, and the graph it produces.

### Animation is not a new mechanism

Animation has now been requested from three directions — multi-page callout
sequences, tutor stepwise `update(item_id, payload)`, and code-driven motion.
All three are **a sequence of states over the document's binding table**,
differing only in what advances it: the reader paging, the tutor sending ops, or
a running program.

```python
for t in range(100):
    osmosis.set_param("a", t / 10)   # the same op the tutor sends
```

Tutor-directed animation of code output therefore requires nothing new: `play`,
`pause` and `set-param` do not care whether a human, a script or the tutor is
producing the states. There is no separate code-animation subsystem.

### Runtimes

| | Python | C++ |
|---|---|---|
| Runtime | **Pyodide** — CPython compiled to WASM, in the browser | **Server-side** compile and run |
| Libraries | numpy, scipy, pandas, matplotlib, **sympy** | Standard library |
| Offline | Works on a local node with no connection | Requires the server |
| Sandbox | The browser's, inherited | Must be built — see below |

The asymmetry is deliberate. In-browser C++ exists (Emscripten-compiled clang)
but is a large download running slowly to provide a worse compiler than the one
already on the server. **C++ not running offline is an accepted limitation.**

`sympy` deserves specific mention: symbolic differentiation, integration and
solving inside a code page, feeding a graph page, is a primary use case rather
than a bonus.

### Reading from documents

The capability that makes code pages worth having: a program reads the
document's own pages, and other documents' pages, through a host API.

```python
import osmosis

data = osmosis.sheet("Lab Data!A2:B40")           # a sheet page in this document
data = osmosis.doc("doc://a3f2").sheet("A2:B40")  # another document

m, b, r = osmosis.linregress(data)
osmosis.plot(f"""
    scatter: {osmosis.points(data)}
    y = {m}x + {b}
    note: "r = {r:.3f}" at (1, 1)
""")
```

**Code emits a graph-engine spec, not an image.** The output is a real `plot`
page — interactive, hoverable, themeable, annotatable, and something a tutor can
point an arrow at. matplotlib remains supported for compatibility and renders to
an image page, but the native path produces a first-class page.

The channel runs both ways: code can write values into a `sheet` page, so a
simulation's output becomes data that another page reads.

### Output targets

| Output | Destination |
|---|---|
| stdout / stderr | Console panel beside the editor |
| Native plot calls | A `plot` page, as a graph-engine spec |
| matplotlib | An image, for compatibility |
| Values and tables | A `sheet` page, or inline |
| Parameter writes | The binding table — which is what produces animation |

### Annotation over code

Highlights, margin notes and tutor callouts pinned to a line live in the
document's overlay layer and **never in the source text**. Anchoring is by line
and column range rather than by character offset, which is both more natural for
code and more robust: a line of code is a far more distinctive fingerprint for
content-addressed re-anchoring than a fragment of prose.

### Tutor tooling

**Core loop** — execute and observe output and errors rather than guessing what
the program does; inline diagnostics pinned to the offending line; proposed
diffs the author accepts or rejects (a suggestion layer, never a write);
**step-through with breakpoints and a variable inspector**, which Python
supports through `sys.settrace` and which is the largest single teaching
multiplier available here.

**Seeing execution** — scrubbable execution traces, reusing the timeline
mechanism above; execution and call graphs rendered by the diagram engine; and
data-structure visualization (linked lists, trees, arrays) through the same.

**Working problems** — test cases with expected-versus-actual diffing; starter
scaffolds with locked and editable regions; and timing-against-input-size plots
rendered by the graph engine, for empirical complexity work.

**Editor** — CodeMirror 6 again, so syntax highlighting, autocomplete, bracket
matching and linting come from the same foundation as the markdown editor. There
is no second editor stack.

### Sandboxing and capability tiers

Server-side execution is arbitrary code execution on the host, and **the tutor
can write code**. Single-user operation on a personal server lowers the stakes
but does not remove them, and the realistic hazard is accidental rather than
malicious: an infinite loop, runaway allocation, or a filled disk.

Execution is therefore split into two capability tiers.

**The sandbox boundary is the workspace root — a course or a curriculum track,
not a single document.** A curriculum track is a set of nested courses; a
workspace is booted rooted at one of them. Whichever folder roots the workspace
is the sandbox. A chemistry course rooted as a workspace is one sandbox; a
computer-science track containing several courses is one sandbox spanning all of
them. **Nothing is shared across that boundary by default** — a course outside
the rooted track is outside the sandbox.

**Tier 0 — default, no prompt.** Pyodide in the browser, reading and writing
documents **within the enclosing sandbox**. No network, no host filesystem, no
access outside the rooted course or track. The browser's sandbox does the
enforcing. This covers the overwhelming majority of use: a program in a chemistry
course reading lab data from a sheet three documents over in the same course,
computing, and emitting a graph.

**Tier 1 — password-gated.** Anything reaching outside that boundary: documents
in another course or track, host filesystem access, package installation,
server-side execution, and the terminal. Gated by an **app-level passphrase set
in settings — not the machine's sudo**. It is held for a session with a timeout
rather than prompted per call, so a working session is not a password prompt
every thirty seconds, and it exists to make leaving the sandbox a deliberate act
rather than something a generated program does incidentally.

> **Terminology.** "Track" is overloaded between these two specs and the
> product. In this document and its sibling, a **track** (track 1–7, D1–D5) is a
> unit of *engineering work*. A **curriculum track** is the product concept — a
> set of nested courses that can root a workspace. Where ambiguity is possible,
> the product sense is always written as "curriculum track."

Server-side execution keeps its hard limits regardless of tier: subprocess
isolation, CPU and wall-clock timeouts, a memory ceiling, restricted network,
and a scratch-only filesystem view. The password authorizes the *category* of
action; it does not lift the resource limits.

### Terminal

A restricted terminal emulator, behind Tier 1, for environment work: installing
packages, running CLIs, inspecting the scratch filesystem.

Restrictions: scoped to the execution sandbox's filesystem, resource-limited,
no privilege escalation, and network access confined to package indexes rather
than open.

**One constraint worth stating plainly, because it splits the same way the
language support does:** Pyodide ships precompiled builds of numpy, scipy,
pandas, matplotlib and sympy, and `micropip` can install pure-Python wheels
in-browser. Anything with a C extension that is not already in the Pyodide
distribution **cannot** be installed in the browser. Real `pip` against the full
package ecosystem is therefore a server-side capability, which means it needs a
connection — the same offline limitation C++ has, for the same underlying
reason.

### Runtime loading

Pyodide is a substantial download. The policy:

- **Not fetched on workspace open.** A workspace with no code pages never pays.
- **Prefetched when a document containing a `code` page is opened**, so the
  runtime is warming while the author reads the page rather than after they
  press run.
- **Cached persistently** after first fetch, so the cost is paid once per
  install rather than per session.

## Track D5 — UI overhaul and polish

The counterpart to the graph spec's customization track, and last for the same
reason: it polishes a finished surface rather than a moving one.

**This track has not had a design pass.** The list below is direction.

- **Typography** — a curated font set with real Greek, math and CJK coverage
  (see the font stack above), per-document and global defaults, size, line
  height, and a controllable measure. `web/src/hooks/useDocumentFont.ts` already
  carries a document-font setting and is the foundation to build out rather than
  replace.
- **Reading themes** — paper, sepia, dark, high contrast, e-ink.
- **Layout controls** — margins, justification, hyphenation, density.
- **Reading affordances** — focus mode, typewriter scrolling, reading progress,
  position memory.
- **Code page theming** — syntax themes consistent with the document theme.
- **Sheet presentation** — grid styling, number formats, borders.
- **Print and export styling** — a dedicated high-contrast, texture-free theme.
- **Settings surface** — per-document settings that override global defaults,
  including the writing mode, with a clear indication of which level a given
  setting is coming from.

Themes must be consistent with the graph engine's theme tokens, so that a plot,
a sheet and a page of prose in one document read as the same object rather than
three applications.

## File classification

One container format. What a file *is* gets derived from its contents rather
than declared:

```
kinds: ['text', 'flow']    # the set of page kinds present
class: 'mixed'             # derived label naming the common cases
```

| Pages present | Class |
|---|---|
| `text` only | `document` |
| `plot` / `space` / `figure` only | `graph` |
| `flow` only | `flowchart` |
| `sheet` only | `spreadsheet` |
| `code` only | `code` |
| more than one family | `mixed` |

Derived, so it can never disagree with the contents: a file that gains a graph
page reclassifies itself. For filtering, `document` and `flowchart` group
together as authored content.

This is **independent of the user-set kind tag** (source, resource, homework,
test, flowchart). Two axes: what is inside is computed, what it is for is
declared. One click opens one viewer either way; the viewer reads the page kinds
present and renders accordingly.

## Non-goals

- Concurrent or collaborative editing. The author writes; the tutor reads.
  No CRDT, no operational transform.
- WYSIWYG block editing in which markdown stops being the stored truth.
- A general-purpose spreadsheet application — no pivot tables, no macros, no
  charts inside the sheet (the document has graph pages for that).
- Designing the workspace shell — sidebar, file tree, tab bar, session routing
  and the code viewing port are specified elsewhere.
- Redefining the document format, which belongs to the graph-engine spec.
- A general-purpose IDE. Code pages serve explanation, data work and coursework;
  project builds, dependency management and multi-file compilation are out.
- Languages beyond Python and C++. The runtime split is specified for exactly
  these two; a third would need its own decision, not a plugin point.

## Open questions

1. **Ruby/furigana support** in Japanese modes is listed as optional and has not
   been decided either way.
2. **Version-snapshot granularity** — autosave snapshots are specified, but how
   many are retained, and whether they are user-visible as a history, is not.
3. **Sheet annotate mode** falls out of the matrix but has no described
   interaction yet. Deliberately deferred to when it is on screen, since it is
   easier to judge than to specify — but the trap is recorded here so it is not
   discovered mid-build. A grid inherits a harder version of the anchor problem
   than prose does: the unit of annotation is undefined (cell, range, row,
   column), and it is undecided whether an annotation anchors to a cell
   *address* or to the *data* in it. Prose has no operation like **sort**, which
   reorders every row at once, and no equivalent of a value changing underneath
   an annotation when a formula recalculates.
4. **Track D5 needs a design pass** before it is built; the section above is
   direction, not a design. Deferred by the author on the grounds that UI polish
   is easier to critique in front of you than to plan in advance.
