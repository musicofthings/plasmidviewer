# Plasmid Viewer — Phase 2 Roadmap: "From viewer to workbench"

**Status:** Draft for review · **Created:** 2026-08-08 · **Owner:** (unassigned)

> Target: the feature set published at <https://www.snapgene.com/features>.
> This document extends [PRD.md](./PRD.md) (FR-1 … FR-30, Milestones 1–3 shipped) with
> FR-31 onward. It is a **sequencing and decision document**, not a commitment — the
> pivotal choices in §3 must be made before any of §5 starts.

---

## 1. Scope reality check

SnapGene is a mature commercial desktop application with roughly fifteen years of
development behind it. Its feature page lists ~60 distinct capabilities across 12
categories. Reaching parity is not "the next phase" — it is a multi-year programme, and
several items on that list are not buildable under this project's current constraints at
all (see §3.2).

That is not an argument against the goal. It is an argument for **sequencing by
dependency rather than by appeal**, because the list is deeply layered: eight of the
headline cloning methods are impossible until three unglamorous foundations exist. This
document orders the work so that each phase produces something usable rather than a
half-built substrate.

**The single most important structural fact:** Plasmid Viewer is today a *read-only
viewer*. Every parsed `Plasmid` is immutable, there is no editing, no undo, and no notion
of a sequence derived from another sequence. Most of the SnapGene list is about
*producing* new constructs. The gap is not a missing feature — it is a missing
architecture.

## 2. Gap analysis

Against the published feature list, mapped to what exists in `src/` today.

| SnapGene category | Status today | Gap |
|---|---|---|
| **Visualizing** | Linear + circular maps, per-base colouring, GC%, complement, 3 forward frames, zoom/pan, virtualized rendering | No RNA/protein views, no secondary structure, no chromosome-scale support, no per-track recolour |
| **Features/Annotations** | Parse, display, colour by type, tooltips, detail panel | No create/edit, no auto-annotation, no custom types, no ribosomal slippage, no translation numbering |
| **Alignment** | Pairwise Myers diff vs. a reference, multi-track stacking | Not a biological aligner (no scoring, gaps, or affine penalties); no MSA; no protein alignment; no contig assembly |
| **Translations** | 3 forward frames, codon table 1 | No ORF finding, no reverse frames, no Make Protein / Reverse Translate, no fusion frame check |
| **Data Management** | Local workspace→project→experiment→sample→sequence library (IndexedDB); GenBank + FASTA export | ✅ FR-35 closed the one-way import |
| **Import formats** | FASTA, GenBank, SnapGene `.dna` | ~20 further formats listed |
| **Search** | DNA (IUPAC, both strands, wraps the origin), protein (6 frames), features | ✅ FR-36 |
| **Restriction enzymes** | REBASE v608, site finding, overhangs, fragments, digest map | ✅ FR-34. No custom enzyme sets or methylation blocking yet |
| **Primers** | Nearest-neighbour Tm, 3'-anchored binding-site search with 5' tails, arrows on the map, primers recovered from `primer_bind` annotations | ✅ FR-37. No design or dimer analysis (FR-39) |
| **PCR & Mutagenesis** | — | Nothing |
| **Molecular cloning** (8 methods) | — | Nothing |
| **Agarose gel simulation** | — | Nothing |
| **History tracking** | — | Nothing |

Roughly: **six of twelve categories are meaningfully served** as of FR-37 — it was two when this
document was written. The six that remain are the ones gated on an editable document (§4) or on
curated data (§3.2), which is exactly the shape the phasing predicted.

## 3. Decisions that must be made first

These three fork the plan. Building past them without deciding wastes work.

### 3.1 Does the product stay backend-free?

[PRD §5](./PRD.md#5-goals--non-goals) states it plainly: *"A backend of any kind. This
stays a static, client-only SPA."* Several listed features cannot honour that:

| Feature | Why it resists the browser | Options |
|---|---|---|
| MSA via **Clustal Omega / MAFFT / MUSCLE / T-Coffee** | Native C/C++ binaries | WASM port (MUSCLE and MAFFT have partial community ports; none is turnkey), a backend, or substitute our own aligner and drop the brand names |
| **Contig assembly (CAP3)** | Native binary, no maintained WASM port | Backend, or implement a simpler OLC assembler ourselves |
| **Secondary structure** (ssDNA/ssRNA/oligo) | Needs ViennaRNA-class folding | ViennaRNA has a usable WASM build — probably viable client-side |
| **Chromosome-scale sequences** | Whole sequence held in memory as a JS string | Feasible client-side with chunked storage + virtualization, but it is a rewrite of the data layer |

Pairwise alignment, enzymes, primers, PCR, gels, and all eight cloning methods are pure
computation over short sequences and are **entirely feasible client-side** — the
constraint only bites on the four rows above.

> **Recommendation:** keep the no-backend constraint. Deliver our own pairwise and
> progressive MSA implementation rather than the named tools, ship ViennaRNA via WASM, and
> treat CAP3-grade assembly as out of scope. Revisit only if users specifically demand the
> named algorithms. This preserves the privacy story, which [PRD §2](./PRD.md#2-problem--motivation)
> identifies as a core differentiator against Benchling.

### 3.2 Where does annotation and enzyme data come from?

Two features depend on curated **data**, not code, and this is the most commonly
underestimated risk in the whole plan:

- **Restriction enzymes.** REBASE is the canonical source. It is free for academic use
  with attribution; commercial redistribution has terms that must be read before we bundle
  it. Needed: recognition sequences, cut offsets, isoschizomers, methylation sensitivity,
  commercial availability.
- **Automatic annotation of common features.** SnapGene's common-feature database is
  proprietary and is a genuine part of its moat. We would need to assemble an equivalent
  from public sources (iGEM Registry, Addgene, UniProt signal sequences). Expect this to be
  a sustained curation effort, not a one-off import.

**Neither is a coding task.** Both should be scoped and legally cleared before the phase
that needs them starts.

### 3.3 Is this still "a fast viewer", or is it now an editor?

The current product bet in [PRD §1](./PRD.md#1-summary) is *"fast, zero-friction"* —
open a file, eyeball it, compare, close. A cloning workbench is a different product with
different quality bars: correctness of a simulated ligation matters far more than render
latency, and a wrong `Gibson Assembly` result is worse than no feature at all.

Both are legitimate. They should not be pursued simultaneously by a small team, and the
answer determines whether §5's Track A or Track B leads.

## 4. Foundations

Nothing in §5 is reachable without these. They deliver little user-visible value on their
own, which is exactly why they are easy to skip and fatal to skip.

- **FR-31 — Mutable document model.** Replace the immutable `Plasmid` with a document that
  supports insert/delete/replace over the sequence, with features, primers, and selections
  shifting correctly across every edit. This is the single largest change in the plan and
  touches every module in [TRD §4](./TRD.md#4-module-map). *Size: XL.*
- **FR-32 — Operation log, undo/redo, and provenance.** Every edit is a recorded operation.
  This delivers SnapGene's *History Tracking* category directly (comprehensive undo,
  graphical history of a product, history colours for recent changes) and is the substrate
  for every cloning simulation, since a cloning product **is** a derived document with a
  parent chain. Designing this *after* FR-31 rather than alongside it means retrofitting.
  *Size: L.*
- **FR-33 — Sequence editing UI.** Select an arbitrary range (finally closing FR-15),
  type over it, insert, delete. Create and edit features by selection; custom feature types.
  *Size: L.*
- **FR-34 — Restriction enzyme engine.** Enzyme database (§3.2), site finding, cut
  computation with 5′/3′ overhangs and blunt ends, methylation sensitivity, predefined and
  custom enzyme sets. Unlocks restriction cloning, Golden Gate, digest gels, silent
  mutagenesis, and enzyme search — five downstream areas from one engine. *Size: L.*
- **FR-35 — Export to GenBank and FASTA.** Import is currently one-way; a workbench that
  cannot emit its constructs is a dead end. This also answers
  [PRD open question 3](./PRD.md#9-open-questions). Cheap, high value, and independently
  shippable — **do this first regardless of everything else.** *Size: S.*

## 5. Phased plan

Two tracks. Track A is the cloning workbench; Track B is analysis and breadth. They share
FR-31…FR-34 and can otherwise proceed independently.

### Phase 2.0 — Groundwork
`FR-35` (export) ✅, `FR-36` **Search** (DNA/RNA/protein, enzymes, features, primers) ✅.

Both are self-contained, neither needs the foundations, and search is the highest
value-to-effort item on the entire SnapGene list. Ships in weeks, not months. *Size: M.*

### Phase 2.1 — The editable document
`FR-31`, `FR-32`, `FR-33`.

No new user-facing capability beyond editing and undo. This is the phase most likely to be
cut short under pressure and the one where that does the most damage.

### Phase 2.2 — Enzymes and primers
`FR-34` (enzymes) ✅ · `FR-37` **Primer model** ✅: Tm by nearest-neighbour, binding-site search,
primer annotation · `FR-38` **PCR simulation** ✅ (standard PCR; overlap-extension deferred, see
below) · `FR-39` **Primer design**, with automatic design for cloning procedures.

FR-37 shipped ahead of Phase 2.1 deliberately: it is the last substantial capability that works
on the read-only architecture, and it is what FR-38 — and through it FR-49 — waits on. The
binding-site search is 3'-anchored rather than full-length, so a primer with a 5' cloning tail is
found at the region it actually anneals to; FR-41 (homology assembly) needs exactly that
distinction, since the tail *is* the overlap.

**FR-38 (standard PCR), shipped.** Every facing pair of binding sites is one product, so a
non-specific reaction reports its extra bands rather than only the intended one. Products carry
the *primers'* bases at both ends — 5' tails included, mismatches spelled the primer's way —
which is what makes them usable for cloning and site-directed mutagenesis rather than being a
slice of the template. On a circular construct a pair pointing outward amplifies the other way
round, so inverse / around-the-horn PCR falls out of the same code path instead of needing a
mode. Source annotations are rebased onto the product when wholly contained and *reported* when
only partly amplified, never carried across truncated. A product opens as its own linear track
(`ampliconPlasmid`), so it can be diffed against the template and exported like any construct —
still read-only, the template is never modified.

Deliberately deferred: **overlap-extension (SOE) PCR**, which the original line item bundled in.
Fusing two products through complementary tails is the same operation as FR-41's homology
assembly, and building it twice under two names is how the enzyme and cloning engines would
drift apart. It should be one engine, built once, in Phase 2.3.

First phase where the product does something SnapGene users would recognise as core.

### Phase 2.3 — Cloning simulation (Track A)
`FR-40` Restriction cloning · `FR-41` Homology-based assembly — **Gibson, NEBuilder HiFi,
and In-Fusion share one engine** and should be built as one feature with three presets ·
`FR-42` Golden Gate (Type IIS, on FR-34) · `FR-43` Gateway (att site recombination) ·
`FR-44` TOPO · `FR-45` TA/GC cloning.

Ordered by reuse, not popularity. FR-40 and FR-41 together cover the majority of real
usage; FR-43–45 are comparatively niche and are reasonable candidates to defer.

### Phase 2.4 — Analysis depth (Track B)
`FR-46` ORF finding · `FR-47` Make Protein / Reverse Translate / reverse frames / fusion
frame checking · `FR-48` Mutagenesis — primer-directed, silent (add/remove sites, on
FR-34); **codon optimisation by usage table is shipped** (see below) ·
`FR-49` Agarose gel simulation with MW markers
(on FR-34 + FR-38) · `FR-50` Real pairwise alignment (Needleman–Wunsch / Smith–Waterman
with affine gaps), replacing the Myers diff and answering
[PRD open question 1](./PRD.md#9-open-questions) · `FR-51` Progressive MSA for DNA and
protein, subject to §3.1.

**Codon optimisation (part of FR-48), shipped.** Codon usage tables for eleven expression
hosts, built from Kazusa CUTG by `scripts/build-codon-tables.mjs` and committed as
`src/data/codonTables.json`. Three strategies — most-frequent, host-distribution-matched, and
replace-rare-only — over a backtracking search that satisfies hard constraints: forbidden
motifs on both strands (including sites that only exist across the junction with the vector),
global and sliding-window GC bounds, homopolymer runs and direct repeats. Constraints it
cannot satisfy are reported rather than silently broken, and the protein is asserted unchanged
on every run.

It ships *ahead* of the rest of FR-48 because it does not need the mutable document model:
the result is offered as a FASTA download and as text to copy — a sequence to order, not an
edit to the construct. Writing it back in place still waits on FR-31, and it is the obvious
first customer for FR-33 once that lands.

Deliberately not attempted: mRNA secondary-structure or 5'-end folding energy (that is FR-54's
ViennaRNA), tRNA-adaptation-index weighting, and any learned model — see the CodonFM note in
§8.

### Phase 2.5 — Breadth and polish
`FR-52` Additional import formats (most are simple text formats; prioritise by user
demand, not by list length) · `FR-53` Auto-annotation (blocked on §3.2 data) ·
`FR-54` Secondary structure via ViennaRNA WASM · `FR-55` Chromosome-scale sequence support
(data-layer rewrite) · `FR-56` Collections and sharing — note this collides with the
standing no-accounts non-goal and needs its own decision.

## 6. Dependency graph

```
FR-35 export ──────────────────────────────────► (independent, ship first)
FR-36 search ──────────────────────────────────► (independent)

FR-31 document model
   └─► FR-32 history/undo
         └─► FR-33 editing UI
               ├─► FR-48 mutagenesis
               └─► all of Phase 2.3

FR-34 enzyme engine
   ├─► FR-40 restriction cloning
   ├─► FR-42 Golden Gate
   ├─► FR-48 silent mutagenesis
   └─► FR-49 gel simulation ◄── FR-38 PCR

FR-37 primers ─► FR-38 PCR ─► FR-39 primer design
                     └────────► FR-41 homology assembly

FR-50 pairwise alignment ─► FR-51 MSA
```

## 7. What this plan deliberately defers

Stated explicitly so the omissions are choices rather than oversights:

- **The four named MSA tools and CAP3** — see §3.1. We ship equivalent capability under our
  own implementation or not at all.
- **FR-43/44/45** (Gateway, TOPO, TA/GC) — real features, low relative usage; revisit after
  FR-40/41 are in users' hands.
- **Cross-platform desktop builds** — the browser is the platform; this line item does not
  apply.
- **Viewer mode / activation** — a licensing concept from a paid product with no analogue here.

## 8. Open questions

1. **§3.3 is the big one:** fast viewer or cloning workbench? If both, which leads?
2. Does "all these features" mean *parity* (a user could switch), or *coverage of the
   common workflows*? The two differ by roughly an order of magnitude in effort.
3. Is the no-accounts, no-cloud non-goal still firm? FR-56 (Collections, sharing) and any
   team workflow contradict it.
4. What is the team size and target date? Every sizing above is relative; without this the
   phases cannot be turned into a schedule.
5. Should correctness of simulated cloning be validated against SnapGene itself as a test
   oracle? [PRD §8](./PRD.md#8-success-metrics) already uses that approach for coordinates,
   and it would be the cheapest way to trust FR-40/41.
6. **Learned codon models — separate project, not this one.** NVIDIA's CodonFM (Encodon) is a
   masked language model over codon tokens; it scores sequences and predicts masked codons,
   but ships no optimiser, and its published weights carry no species conditioning, which is
   the whole question a codon optimiser answers. It is also 80M–1B parameters of PyTorch with
   no hosted endpoint, so it cannot run in a no-backend browser app. If it is pursued it
   belongs in its own service on NVIDIA cloud, with this app calling it — and the honest first
   use is *scoring* (a per-codon likelihood heatmap over a CDS), which needs no mutable
   document model either. The table-driven optimiser above is not a stopgap for it: it answers
   a different, well-posed question, and it is the one a synthesis order actually needs.
