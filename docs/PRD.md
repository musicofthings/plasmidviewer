# Plasmid Viewer — Product Requirements Document (PRD)

**Status:** Draft v1 · **Last updated:** 2026-07-13 · **Owner:** (unassigned)

> This PRD was reverse-engineered from the existing prototype and extended with a
> prioritized roadmap. It reflects the app as of the current `src/` tree and is the
> source of truth for *what* we are building and *why*. The [TRD](./TRD.md) covers *how*.

---

## 1. Summary

Plasmid Viewer is a browser-based tool for **visualizing and comparing annotated DNA
constructs**. A user opens one or more sequence files (FASTA / GenBank / SnapGene),
sees an annotated linear or circular map, scrolls the base-level sequence, aligns
multiple constructs as stacked tracks, and exports a publication-style PNG. Everything
runs client-side — no upload, no account, no backend.

The near-term product bet: give bench molecular biologists a **fast, zero-friction,
privacy-preserving** way to eyeball a construct and compare a sequencing result or a
variant against a reference, without opening SnapGene or Benchling.

## 2. Problem & motivation

- Desktop tools (SnapGene) are paid, install-gated, and single-file oriented.
- Web platforms (Benchling) require accounts and upload of potentially sensitive IP.
- Quick "does this map look right / how does track B differ from the reference" checks
  are heavier than they should be.
- Multi-construct **visual comparison** (e.g. reference vs. Sanger/NGS consensus, or a
  panel of variants) is poorly served by single-plasmid viewers.

## 3. Target users

| Persona | Need | Success looks like |
|---|---|---|
| **Bench molecular biologist** | Open a `.dna`/`.gb`, confirm features and orientation | Map renders in <2s, features legible |
| **Cloning / synbio engineer** | Compare a construct against a reference or expected map | Differences are visually obvious and correctly positioned |
| **Sequencing analyst** | Overlay a consensus/variant track on a reference | Mismatches, insertions, deletions are marked at correct coordinates |
| **PI / student (figure-making)** | Produce a clean map for a slide/paper | One-click PNG export at usable resolution |

Explicit non-user (for now): LIMS/ELN integrators, wet-lab automation, regulated
clinical reporting.

## 4. Current state

> **Milestone 1 (P0) is complete.** Coordinates are unified and fixture-tested, the alignment
> scale is in base pairs and shared across tracks, and diff visualization now ships. The
> "known correctness gaps" listed at the bottom of this section are fixed; they are kept here
> for the record. See [TRD §7](./TRD.md#7-known-issues--tech-debt) for detail — including a
> bug the original audit missed: `alignSequences` was not just unwired, it was **incorrect**
> (it misread the Myers diff tuple shape and reported mismatches at the wrong positions).

**Working:**
- **Diff visualization (FR-16):** every non-reference track is diffed against the reference
  and its substitutions, insertions, and deletions are marked at the correct base, with a
  per-mark tooltip and a diff count in the track header.

**Working (from v0):**
- File import: FASTA (`.fasta/.fa/.txt`), GenBank (`.gb/.gbk`), SnapGene (`.dna`) via
  `@teselagen/bio-parsers`.
- Multi-track model: open multiple files as stacked tracks (first is "reference").
- **Linear view**: SVG backbone per track + strand-aware feature arrow glyphs with labels.
- **Circular view**: arc-based map with along-arc labels (reference track only).
- **Sequence viewer**: horizontally scrollable, monospace, per-base coloring (A/T/G/C).
- Zoom in/out and click-a-feature-to-frame-it (adjusts sequence viewport).
- **PNG export** of the whole multi-track canvas via `html-to-image`.
- Manual track alignment: drag a non-reference track horizontally, or "Align to File"
  (auto pixel offset via longest common diff block).

**Resolved dead code:**
- `alignSequences` + `AlignmentView` — **promoted** into the linear track (FR-16), and the
  underlying diff algorithm fixed.
- `ViewportOverlay` and the unused `ViewerState`/`zoomLevel` types — **deleted**. A
  feature-detail panel remains genuinely unbuilt (FR-20, Milestone 2); there is now no code
  pretending otherwise.

**Known correctness gaps — all fixed:**
- ~~GenBank vs. SnapGene use inconsistent coordinate conversion (likely off-by-one on GenBank
  feature ends).~~ Confirmed and fixed: Teselagen emits 0-based *inclusive* ranges, so both
  ends take `+1`. GenBank was off by one on `end`. Both parsers now share one converter.
- ~~"Alignment" offset mixes base-pair units and pixel units; cross-track scale differs.~~
  Offsets are stored in base pairs and all tracks render on one shared `pxPerBp` scale, so
  lining tracks up is now biologically meaningful.

**Milestone 2 (P1) — shipped:**
- **Zoomable map (FR-6):** a single viewport, in reference base pairs, drives the ruler,
  every track's glyphs, the diff marks and the sequence strip. Zoom buttons, ⌘/Ctrl+wheel
  around the cursor, drag-to-pan; the sequence view can no longer disagree with the map
  (FR-13), because both read the same viewport.
- **bp ruler (FR-7)** with 1/2/5×10ⁿ tick steps.
- **Label de-collision (FR-8):** greedy lane packing on pixel extents. A label too wide for
  its glyph spills to one side and that space is reserved, so labels can't overlap; near the
  right edge a label flips to the left of its glyph rather than being clipped.
- **Multi-track circular (FR-10):** concentric rings, one per track, on a shared angular
  coordinate system.
- **Detail panel (FR-20, FR-18):** click a feature *or* a diff mark for name/type/strand/
  start/end/length, or position/ref/query, plus *Zoom to*.
- **Dark mode (FR-24)** with a toggle, and **view-aware export (FR-22)** — exports the active
  view (linear or circular) at 1x/2x/3x.
- **Inline errors & warnings (FR-3):** parse/align/export failures surface inline; a file with
  non-standard bases (IUPAC ambiguity codes or junk, anything outside `ACGTU`) loads anyway and
  shows a non-blocking warning naming the offending characters — e.g. `test.gb`'s stray `h`
  reports "contains 1 non-standard base (H)".

**Also shipped (Milestone 3):**
- **Virtualization (FR-9):** lanes are packed in *track-local* pixels, so the layout depends
  on the zoom but not on where the viewport sits — panning cannot reflow it. Only the
  features and bases that can actually appear on screen become SVG nodes. The sequence strip
  still degrades by zoom: letters at ≥7 px per base, colored bars down to 1.5 px, and
  "Zoom in to read bases" below that.
- **Complement + translation (FR-14):** optional complement strand and all three forward
  reading frames, with start codons and stops called out.
- **SVG export (FR-23):** the linear map is a single SVG, so export is serialization rather
  than rasterization — vector out, fonts embedded, theme colors baked in. PNG is that same
  SVG drawn onto a canvas.
- **Persistence (FR-26):** the session (tracks, offsets, view mode) is written to IndexedDB
  and restored on reload.
- **Keyboard navigation (FR-25):** the map is a focusable widget — arrows pan, `+`/`−` zoom,
  `0` fits, `n`/`p` walk the features, `Esc` clears. Glyphs are focusable and activate on
  Enter/Space.

**Also shipped (P2 backlog cleared):**
- **Topology detection (FR-5):** GenBank/SnapGene records set circular vs. linear; the first
  file opened selects the matching initial view. FASTA carries no topology, so it is linear.
- **Circular metadata (FR-12):** the hub shows length, topology and GC%, and an origin tick
  marks base 1 at 12 o'clock so orientation is unambiguous.
- **Track management (FR-19):** a track panel to rename, show/hide, reorder, and remove each
  track. Reordering is meaningful — moving a track to the top makes it the new reference, which
  recomputes every diff against it.
- **Copy subsequence (FR-15, partial):** selecting a feature exposes a *Copy sequence* button
  that copies exactly that feature's bases. Drag-to-select an arbitrary range is still open.
- **Touch drag (FR-25):** pan and track-align drags now use pointer events, so touch and pen
  work, not just the mouse.

**Still open:** arbitrary-range sequence selection (the rest of FR-15); multi-record files
(FR-4); circular label de-collision / leader-lines (FR-11); glyph↔sequence hover linking
(FR-21); per-track recolor (the color field exists but nothing renders per-track color yet).

## 5. Goals & non-goals

### Goals (this cycle)
1. Make the **comparison / alignment** story real and correct — it's the differentiator.
2. Fix coordinate correctness so features and diffs land on the right base.
3. Turn the linear map into a true **zoomable** map (not just a sequence scroller).
4. Add a **feature-detail / selection** interaction.
5. Remove dead code or promote it into shipped features.

### Non-goals (explicitly out of scope for now)
- Sequence **editing** / construct design / cloning simulation.
- Primer design, restriction digest simulation, ORF finding (candidate future work).
- Accounts, cloud storage, sharing, collaboration.
- A backend of any kind. This stays a static, client-only SPA.
- Mobile-first layout (desktop-first is fine; must not be broken on tablet).

## 6. Functional requirements

Priorities: **P0** = correctness/must-fix, **P1** = core roadmap, **P2** = later.

### 6.1 Import & parsing
- **FR-1 (P0):** Parse FASTA, GenBank, SnapGene into a single canonical `Plasmid` model
  with **one** documented coordinate convention (1-based inclusive).
- **FR-2 (P0):** Feature coordinates from every parser must be identical for the same
  biological feature (fix GenBank/SnapGene inconsistency).
- **FR-3 (P1):** Surface parse errors and warnings inline (bad file, empty sequence,
  non-nucleotide characters) instead of only `console.error`.
- **FR-4 (P2):** Support multi-record files (pick record, or load all as tracks).
- **FR-5 (P2):** Detect and label topology (circular vs. linear) from the source file
  rather than assuming.

### 6.2 Linear map
- **FR-6 (P1):** Zoom/pan act on the **feature map**, not only the sequence strip —
  glyph positions rescale with zoom, with a shared coordinate ruler.
- **FR-7 (P1):** Render a base-pair **ruler/axis** with tick marks.
- **FR-8 (P1):** Handle feature label collisions (stacking / lanes) for dense maps.
- **FR-9 (P2):** Virtualize rendering for large constructs (≥50 kb) to keep interaction smooth.

### 6.3 Circular map
- **FR-10 (P1):** Render **all visible tracks** as concentric rings (today only the reference shows).
- **FR-11 (P2):** Feature label leader-lines / de-collision on the circle.
- **FR-12 (P2):** Show length, GC%, and origin marker.

### 6.4 Sequence view
- **FR-13 (P1):** Keep base-level view in sync with map zoom/pan (shared viewport).
- **FR-14 (P2):** Optional complement strand and 3-frame translation.
- **FR-15 (P2):** Text selection → show coordinates and copy subsequence.

### 6.5 Multi-track comparison (the differentiator)
- **FR-16 (P0):** Ship real diff visualization: mark substitutions, insertions, and
  deletions of each track relative to the reference at correct coordinates (promote
  `alignSequences` + `AlignmentView`).
- **FR-17 (P0):** Alignment offset must be expressed in **base pairs** and rendered with
  a **shared bp→px scale** across all tracks.
- **FR-18 (P1):** Per-mismatch tooltip/detail (position, ref base(s), query base(s), type).
- **FR-19 (P2):** Track reorder, rename, per-track show/hide and color.

### 6.6 Feature interaction
- **FR-20 (P1):** Click a feature → detail panel (name, type, strand, start/end, length).
- **FR-21 (P2):** Hover highlight linking map glyph ↔ sequence span.

### 6.7 Export & output
- **FR-22 (P1):** Export current view (linear or circular), with a resolution/scale option.
- **FR-23 (P2):** SVG export in addition to PNG (vector for publications).

### 6.8 Cross-cutting
- **FR-24 (P1):** Wire up the already-themed **dark mode** with a toggle.
- **FR-25 (P2):** Keyboard-accessible navigation for zoom/pan and feature selection.
- **FR-26 (P2):** Local persistence (last session / recent files) via IndexedDB.

## 7. Proposed roadmap

**Milestone 1 — "Correct & honest" (P0) — ✅ done**
Unify coordinate convention (FR-1/2), fix bp-vs-px alignment scale (FR-17), ship diff
visualization (FR-16), delete or promote dead code. *Outcome: the comparison feature
works and lands on the right base.*

**Milestone 2 — "A real map" (P1) — ✅ done**
Zoomable linear map with ruler + label de-collision (FR-6/7/8), synced sequence view
(FR-13), multi-track circular (FR-10), feature-detail panel (FR-20), dark mode (FR-24),
view-aware export (FR-22).

**Milestone 3 — "Depth" (P2) — ✅ done**
Virtualization for large constructs (FR-9), translation/complement (FR-14), SVG export
(FR-23), persistence (FR-26), accessibility (FR-25).

## 8. Success metrics

- **Correctness:** feature/diff coordinates match SnapGene for a fixed test-fixture set
  (0 off-by-N regressions in CI).
- **Performance:** open + first render of a 10 kb plasmid < 1s; smooth (≥50fps) pan/zoom
  up to 50 kb.
- **Reach of the differentiator:** comparison view reachable in ≤2 clicks from load.
- **Robustness:** malformed files produce a clear inline error, never a blank screen.

## 9. Open questions

1. What is the canonical alignment algorithm for the comparison view — is a global
   Myers diff on raw sequence sufficient, or do we need seed-and-extend for divergent
   or offset constructs?
   *Partial answer from Milestone 1:* global Myers is correct and fast enough at plasmid
   scale, but it returns *a* minimal edit script, not a biologically-motivated one. In
   repetitive sequence it splits an indel across the repeat (a 5 bp deletion inside a
   `GCTAGCTAG` repeat comes back as 1+2+2 bp at three positions). Total bases changed are
   right and the marks land inside the repeat, but the breakdown is an alignment artifact.
   If users need indels reported as single biological events, that argues for
   seed-and-extend (or at least left-normalizing indels, as VCF does).
2. Circular multi-track: concentric rings, or a single ring with a track selector?
3. Do we need GenBank/SnapGene **export** (round-trip), or is import + PNG enough?
4. Is large-construct (whole-genome-ish) support in scope, or do we cap at plasmid scale
   (say ≤300 kb)?
