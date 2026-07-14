# Plasmid Viewer

A browser-based viewer for annotated DNA constructs. Open one or more sequence files
(FASTA / GenBank / SnapGene), see an annotated linear or circular map, read the bases,
compare tracks against a reference, and export a PNG.

Everything runs client-side. There is no backend, no upload, and no account — the files
never leave the machine.

See [`docs/PRD.md`](docs/PRD.md) for what we're building and why, and
[`docs/TRD.md`](docs/TRD.md) for how it's built.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Then click **Open File** and pick something from `src/__fixtures__/`:

| Fixture | What it's good for |
|---|---|
| `test.gb` | GenBank with 3 features (`CDS 1..30`, `promoter 40..50`, `terminator 80..90`) |
| `dense.gb` | 10 overlapping features with long names — exercises label lanes |
| `test.fasta` | Plain reference sequence, no features |
| `track2-variant.fasta` | `test.fasta` with a known substitution at base 10, a 5 bp deletion at 50–54, and a `GGGG` insertion after base 80 |

To see the comparison view, open `test.fasta` first (it becomes the **reference**), then
**Add Track** → `track2-variant.fasta`. The diff row under the second track marks the
substitution, deletion and insertion; click any mark to inspect it.

## Using it

- **Zoom / pan** — `+` / `−` / `Fit` buttons; drag the ruler or the reference track to pan;
  ⌘/Ctrl + scroll to zoom around the cursor.
- **Keyboard** — click the map to focus it, then: `←` `→` pan (hold Shift for a bigger step),
  `+` `−` zoom, `0` fit, `n` / `p` jump to the next / previous feature, `Esc` clear the
  selection. Feature glyphs are focusable and open on Enter or Space.
- **Read the bases** — *Complement* adds the reverse strand; *Translation* adds all three
  forward reading frames, with start codons in green and stops in red. Bases render as
  letters when they are wide enough, as colored bars when they aren't.
- **Inspect** — click a feature or a diff mark to open the detail panel, then *Zoom to*.
- **Compare** — the first file opened is the reference. Every later track is diffed against
  it. Drag a non-reference track to shift its alignment, or use *Align to File*.
- **Export** — exports whichever view is showing (linear or circular). **SVG** is true vector
  with the fonts embedded, which is what you want for a figure; **PNG** rasterizes the same
  SVG at 1x/2x/3x. Both bake in the current light/dark colors.
- **Persistence** — the session (tracks, offsets, view mode) is kept in IndexedDB and comes
  back on reload. *Clear All* forgets it. Nothing leaves the machine.

## Scripts

```bash
npm run dev      # dev server
npm test         # vitest
npm run lint     # eslint
npm run build    # tsc -b && vite build
```

## Coordinates

One convention, enforced at the parser boundary: **1-based, inclusive at both ends**.
A feature's length is `end - start + 1`. `@teselagen/bio-parsers` emits 0-based inclusive
ranges, so `src/parsers/teselagen.ts` adds 1 to *both* ends — it is the single place that
conversion happens, which is what keeps GenBank and SnapGene from disagreeing.
