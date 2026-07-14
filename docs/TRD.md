# Plasmid Viewer — Technical Requirements Document (TRD)

**Status:** Draft v1 · **Last updated:** 2026-07-13 · **Companion to:** [PRD](./PRD.md)

> Describes *how* the app is built and the concrete technical work implied by the PRD.
> Requirement IDs (FR-n) reference the PRD.

---

## 1. Architecture overview

A **single-page, client-only React app**. No backend, no network calls, no auth. Files
are read locally via the File API and parsed in the browser; nothing leaves the machine.
This is a deliberate privacy property and a product constraint (PRD non-goal: no backend).

```
File (FASTA/GenBank/SnapGene)
        │  parsers/*  ──►  Plasmid (canonical model)
        ▼
   Track[]  (App state)
        │
        ▼
   PlasmidViewer ──► Linear view  (Backbone + FeatureGlyph + SequenceViewer + diff)
                └──► Circular view (CircularBackbone)
        │
        ▼
   html-to-image ──► PNG
```

Because there is no server, the global CORS/proxy rules do **not** apply to this project.
If a backend is ever introduced, revisit that decision explicitly.

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| UI framework | React 19 + TypeScript | function components + hooks |
| Build | Vite 7 | `dev` / `build` (`tsc -b && vite build`) / `preview` |
| Component lib | MUI Joy (`@mui/joy`) + Emotion | Joy theme in `App.tsx` |
| Fonts | Inter (UI), Roboto Mono (sequence) | `@fontsource/*` |
| Bio parsing | `@teselagen/bio-parsers` | GenBank + SnapGene |
| Diffing | `fast-myers-diff` | powers alignment/comparison |
| Export | `html-to-image` | DOM → PNG |
| Lint | ESLint 9 + typescript-eslint | `npm run lint` |
| Test | Vitest 4 | `npm test` / `npm run test:watch` |

## 3. Data model

Canonical models live in `src/models/` and `src/state/`.

```ts
// models/plasmid.ts
type Strand = "+" | "-";
interface Feature {
  id: string;
  name: string;
  type: "CDS" | "promoter" | "terminator" | "marker" | "misc";
  start: number; // 1-based inclusive  ← MUST be enforced by every parser
  end: number;   // 1-based inclusive
  strand: Strand;
}
interface Plasmid { name: string; length: number; sequence: string; features: Feature[]; }

// state/viewerState.ts
interface Track { id: string; plasmid: Plasmid; offset: number; color: string; isVisible: boolean; }
interface Viewport { start: number; end: number; }
```

**Coordinate convention (normative):** all `Feature.start/end` are **1-based, inclusive,
both ends**. Length of a feature = `end - start + 1`. Every parser converts *into* this
convention at the boundary; no other convention may leak past `parsers/`.

## 4. Module map

| Module | Responsibility | State |
|---|---|---|
| `App.tsx` | File upload, `Track[]` state, theme, empty state | live |
| `components/PlasmidViewer.tsx` | Orchestrates linear/circular, zoom, export, per-track drag/align | live |
| `components/Backbone.tsx` | Linear backbone line | live |
| `components/FeatureGlyph.tsx` | Strand-aware feature arrow + label | live |
| `components/SequenceViewer.tsx` | Scrollable base-level strip, base coloring | live |
| `components/CircularBackbone.tsx` | Circular arcs + along-arc labels | live (ref track only) |
| `components/Ruler.tsx` | bp axis with 1/2/5×10ⁿ ticks; drag surface for panning | live |
| `components/DetailPanel.tsx` | Feature *or* mismatch detail + "Zoom to" | live |
| `utils/layout.ts` | Tick steps; greedy lane packing + label placement | live |
| `parsers/fasta.ts` | FASTA → Plasmid (no features) | live |
| `parsers/teselagen.ts` | Teselagen record → `Plasmid`/`Feature`; **the one place coordinates are converted** | live |
| `parsers/genbank.ts` | GenBank → Plasmid (via `teselagen.ts`) | live |
| `parsers/snapgene.ts` | SnapGene `.dna` → Plasmid (via `teselagen.ts`) | live |
| `utils/alignment.ts` | Myers diff → `Mismatch[]`; `calculateOffset` | live |
| `components/AlignmentView.tsx` | Renders `Mismatch[]` as a diff track | live |
| `state/viewerState.ts` | `Viewport`/`Track` types | live |

## 5. Coordinate & scaling model (the core correctness area)

There are three coordinate spaces and today they are conflated:

1. **Sequence space** — base indices (1-based inclusive in our model; 0-based when slicing).
2. **Map pixel space** — SVG x within a track, currently `(#!bp / track.length) * containerWidth`.
3. **Screen/drag space** — raw `clientX` pixel deltas from mouse drag.

**Implemented (FR-2, FR-17):**
- A **single global scale** `pxPerBp = containerWidth / referenceLength` lives in
  `PlasmidViewer` and is shared by every track. A track shorter than the reference now
  draws a proportionally shorter backbone (`length * pxPerBp`) instead of being stretched
  to the container width, so all tracks sit on a common axis.
- `Track.offsetBp` is stored in **base pairs** and converted to px once at render
  (`offsetBp * pxPerBp`). The drag handler converts pixel delta → bp
  (`deltaPx / pxPerBp`) before writing state, so the two paths that set an offset
  (`calculateOffset` and dragging) finally agree on units.
- Parsers converge on 1-based inclusive via `parsers/teselagen.ts` (see §7.1).

### 5.1 The viewport is the single source of truth (Milestone 2)

`PlasmidViewer` holds one `Viewport {start, end}`, in **reference base pairs, 1-based
inclusive**. Everything on screen is derived from it:

```
spanBp   = viewport.end - viewport.start + 1
pxPerBp  = containerWidth / spanBp
bpToPx(bp) = (bp - viewport.start) * pxPerBp     // left edge of 1-based base `bp`
```

A feature spanning `start..end` inclusive is drawn from `bpToPx(start)` to
`bpToPx(end + 1)` — the exclusive right edge is what makes the inclusive convention render
correctly (an off-by-one here draws every feature one base short).

The ruler, each track's glyphs, the diff marks and the sequence strip all call this same
`bpToPx`, which is why they cannot drift out of sync (FR-6/FR-13). A track's own coordinates
are mapped into reference space by its `offsetBp`: `trackBpToPx(bp) = bpToPx(bp + offsetBp)`.

Zoom changes `spanBp` (clamped to `[MIN_SPAN_BP, plasmid.length]`) about an anchor base; pan
converts a pixel delta to bp (`deltaPx / pxPerBp`) and clamps `start` so the viewport can
never leave the construct.

**Lane assignment runs over all features, not just visible ones** — culling first would make
features hop between lanes as they scroll in and out of view while panning.

## 6. Rendering approach

- Linear map and circular map are hand-rolled **SVG** (no charting lib) — keep it.
- The linear map is **one SVG root**, not a stack of HTML boxes each wrapping a nested SVG.
  Vertical stacking (ruler → header → glyph lanes → diff row → sequence rows) is therefore
  computed rather than left to the DOM: `stackTracks` in `utils/layout.ts` is the single
  place it happens, shared by the on-screen map and the export.
- **Virtualization (FR-9) is done.** `assignLanes` packs in *track-local* pixels, so the
  layout depends on `pxPerBp` but not on `viewport.start` — it is invariant under panning,
  which is what stops features hopping lanes as they scroll in and out. `cullToViewport`
  then narrows an already-laid-out track to what can appear on screen, with a 250 px margin
  so a spilled label does not pop at the edge. Culling cannot reflow the layout.
- Export serializes our own SVG (`utils/export.ts`): `buildStandaloneSvg` clones the map,
  bakes `var(--joy-*)` down to concrete colors against the live document (a standalone SVG
  has no Joy theme), embeds the latin font subsets, and adds a background rect. SVG export is
  that string; PNG is that string drawn onto a canvas via `Image.onload`.

## 7. Known issues & tech debt

Ordered roughly by severity. Items 1–4 were the Milestone 1 (P0) set and are **resolved**.

1. ~~**Coordinate inconsistency (correctness, P0).**~~ **Resolved.** The Teselagen convention
   was pinned down empirically: it emits **0-based inclusive** ranges (GenBank `CDS 1..30`
   comes back as `{start: 0, end: 29}`), so 1-based inclusive requires `+1` on **both** ends.
   `snapgene.ts` was already correct; `genbank.ts` was off by one on `end`, exactly as
   suspected. Both parsers now convert through `parsers/teselagen.ts`, so they cannot drift
   apart again. Fixture tests assert the coordinates against `test.gb`'s own FEATURES table.
2. ~~**Alignment offset unit bug (correctness, P0).**~~ **Resolved** — see §5.
3. ~~**Per-track scale (correctness, P0).**~~ **Resolved** — see §5.
4. ~~**Dead code (P0 cleanup).**~~ **Resolved.** `AlignmentView` + `alignSequences` were
   promoted into the linear track (FR-16); `ViewportOverlay` and the unused
   `ViewerState`/`DEFAULT_ZOOM` types were deleted.

   Promoting the diff view uncovered a bug the audit had not caught: **`alignSequences` was
   not merely unwired, it was wrong.** `fast-myers-diff`'s `diff()` yields 4-tuples
   `[sx, ex, sy, ey]` (the *differing* ranges), but the code destructured them as
   `[sx, sy, lenX, lenY]` and then treated them as *matching* ranges, walking the gaps
   between them. A single C→T substitution at base 4 was reported as a substitution at
   base 1 of `AAA` → `AAAT`. `calculateOffset` had the mirror-image bug: it searched `diff()`
   for the longest block, which finds the longest **difference**, not the longest match — it
   now uses `lcs()`. Both are covered by tests. The lesson: dead code hid a broken
   implementation, not just an unshipped one.

5. ~~**Circular view ignores multi-track (P1).**~~ **Resolved.** Every visible track renders as
   a concentric ring (FR-10). The circular view still ignores the viewport — it always shows
   the whole construct — which is intentional: zoom/pan are linear-map concepts.
6. ~~**Zoom is sequence-only (P1).**~~ **Resolved** — the viewport now drives the map (§5.1).
7. **Error handling (P1, mostly done).** Parse, "Align to File" and *export* failures are now
   surfaced inline instead of being swallowed, and the parse error is no longer rendered only
   in the empty state (so a failed *second* track is visible too). Still outstanding for FR-3:
   warnings for non-nucleotide characters — `test.gb` contains a stray `h` base that is parsed
   and rendered grey with no warning.
8. ~~**Code hygiene (P2).**~~ **Resolved** in the files touched: `substr`/`Math.random()` ids
   replaced with `crypto.randomUUID()`, and the `any`-typed feature mapping in the parsers is
   now typed via `TeselagenFeature`.
9. **Drag alignment is mouse-only (P2, partly resolved).** The *map* is now keyboard-navigable
   (FR-25): the linear SVG is a focusable widget (arrows pan, `+`/`−` zoom, `0` fits, `n`/`p`
   walk the features, `Esc` clears) and each glyph is focusable and activates on Enter/Space.
   Shifting a track's alignment is still drag-only, and there is no touch path.
10. ~~**Dark mode defined but inert (P2).**~~ **Resolved** (FR-24): toggle wired via Joy's
    `useColorScheme`, hardcoded `#fdfdfd`/`#f9f9f9` replaced with `background.surface`.
    **Trap worth remembering:** Joy's dark neutral scale is *inverted* — `text.primary`
    resolves to `neutral.100` in dark mode. Overriding the dark neutral scale with
    light-mode-shaped values (low number = light colour) renders text near-black on a
    near-black background. Dark now only overrides the hue tokens the SVG layers read
    (`primary`, `danger`) and leaves `neutral` to Joy. Prefer semantic `text.*` tokens over
    raw `neutral.*` for anything that is text.
11. ~~**README is the Vite template (P2).**~~ **Resolved** — replaced with real setup, fixture
    and usage docs.
12. ~~**Export hangs in a background tab (P2).**~~ **Resolved** (FR-23). `html-to-image`
    resolved inside a `requestAnimationFrame`, which Chrome never fires in a hidden tab, so an
    export started and then tabbed away from hung forever; the 20s timeout was only a
    mitigation. The dependency is now **removed**: the linear map is a single SVG, so export is
    serialization, and PNG rasterizes through `Image.onload` — which has no rAF dependency, so
    a background tab no longer matters.

## 8. Testing strategy

**Vitest** (`npm test`), 70 tests in five files. Fixtures live in `src/__fixtures__/` and are
loaded with Vite's `?raw` import, so tests need no Node `fs` access and typecheck under the
app tsconfig.

- `parsers/parsers.test.ts` — asserts GenBank feature coordinates against `test.gb`'s own
  FEATURES table (`CDS 1..30`, `promoter 40..50`, `terminator 80..90`), which is 1-based
  inclusive by the GenBank spec. This is the guardrail for §5/§7.1: reintroducing the old
  `end: f.end` off-by-one fails four tests.
- `utils/alignment.test.ts` — exact `Mismatch[]` for sub/ins/del, plus a fixture pair
  (`test.fasta` vs `track2-variant.fasta`, which carries a known sub at base 10, a 5 bp
  deletion at 50–54, and a `GGGG` insertion after base 80).
- `utils/layout.test.ts` — tick steps, and lane packing: overlapping features get separate
  lanes, a lane is reused once free, an outside label reserves its own space, and a label near
  the right edge flips left instead of being clipped.
- `components/PlasmidViewer.test.tsx` — renders via `react-dom/server` and asserts the emitted
  SVG geometry. `containerWidth` defaults to 1000 before the ResizeObserver fires and effects
  don't run under `renderToString`, so the layout math is deterministic and the shared-scale
  and bp-offset guarantees of §5 are assertable directly (a 50 bp track must draw a 500 px
  backbone, not a stretched 1000 px one).

Fixtures: `test.gb` (3 features, known GenBank coordinates), `dense.gb` (10 overlapping
features with long names — the label-lane case), `test.fasta` (reference) and
`track2-variant.fasta` (known sub/del/ins against it).

Note on Myers: `alignSequences` is only guaranteed to return *a* minimal edit script, not a
specific one. In repetitive sequence several scripts are equivalent (the fixture's 5 bp
deletion sits in a `GCTAGCTAG` repeat and comes back split as 1+2+2 bp). Tests must assert
invariants — total bases changed, `refChar` matching the reference at `pos` — not a
particular sub/ins/del breakdown.

Still to do: a real `.dna` fixture (there is none in the repo, so the GenBank↔SnapGene
equivalence of FR-2 is currently enforced *structurally* — both parsers call the same
`featureFromTeselagen` — and tested at that function, rather than through a parsed `.dna`
file). Component smoke tests for the circular view. Wire `lint` + `test` into CI.

## 9. Proposed technical work (mapped to PRD milestones)

**Milestone 1 (P0): done.** Normalized coordinates + fixtures (§5, §7.1); shared `pxPerBp`
and `offsetBp` (§5, §7.2/7.3); promoted the diff view and deleted the rest of the dead code
(§7.4); added Vitest + parser/alignment/geometry tests (§8).

**Milestone 2 (P1): done.** Map-level zoom with a bp ruler and label lanes (FR-6/7/8); shared
viewport between map and sequence (FR-13, §5.1); concentric multi-track circular (FR-10);
feature/mismatch detail panel driven by real selection state (FR-20/18); dark-mode toggle +
tokenized colors (FR-24); view-aware export at 1x/2x/3x (FR-22).

**Milestone 3 (P2): done.** Virtualization/culling for large constructs (FR-9, §6);
complement + 3-frame translation (FR-14); SVG export, which also removed `html-to-image`
(FR-23, §7.12); IndexedDB session persistence (FR-26); keyboard interaction (FR-25, §7.9 —
touch is still open).

## 10. Constraints & conventions

- Client-only; no backend, no telemetry, no file upload off-device.
- One coordinate convention (1-based inclusive) enforced at parser boundaries.
- Prefer editing existing modules over adding new ones; keep SVG hand-rolled.
- No comments except where the *why* is non-obvious (project standard).
