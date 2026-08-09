# Session Handover
_Generated: 2026-08-09T09:35:00Z_
_Branch: main_
_Trigger: user request | Context at compact: n/a_
_Compact count this project: 0_

---

## 🎯 Active Task
**What we're building/fixing:**
Working through the Phase 2 roadmap toward the SnapGene feature set
(<https://www.snapgene.com/features>). The plan lives in `docs/ROADMAP-PHASE2.md` and extends
the existing PRD's FR numbering from FR-31 onward. Phase 2.0 (export, search), the
restriction-enzyme engine and the primer model are shipped — six of SnapGene's twelve
categories are now meaningfully served, up from two.

**Phase:** Phase 2 — "From viewer to workbench"
**Next action:** **FR-38 (PCR simulation)** is the natural continuation — it is the only thing
standing between here and FR-49 (gel simulation), and FR-41 (Gibson / NEBuilder HiFi /
In-Fusion, one engine with three presets) needs a PCR product too. It still works on the
read-only architecture.

The alternative is to stop deferring **FR-31 (mutable document model)**: the months-long
substrate that all of Phase 2.3 (cloning) waits on, with no user-visible output until FR-33.
Every read-only-architecture feature except FR-38/39/46/47/49/50 is now done, so the runway
above that line is nearly used up.

---

## ✅ Completed This Session
- [x] Full-repo code review — 6 real defects found, all fixed and verified
- [x] Fixed FASTA multi-record corruption (records were silently concatenated into one chimera)
- [x] Fixed viewport reset on every keystroke when renaming the reference track
- [x] Fixed per-frame re-diff during alignment drags (memo keys were too coarse)
- [x] Fixed circular view ignoring track offsets
- [x] Fixed file inputs not resetting after a failed parse
- [x] Fixed `withStore` resolving before the IndexedDB transaction committed (+ connection leak)
- [x] Removed dead Vite scaffolding; added a real favicon and page title
- [x] Lazy-loaded `@teselagen/bio-parsers` — initial bundle 811 kB → 357 kB
- [x] Migrated hosting: GitHub Pages **disabled**, now Cloudflare Pages behind Cloudflare Access
- [x] Merged `deploy.yml` into `ci.yml` (one workflow, no duplicated lint/test/build)
- [x] Wrote `docs/ROADMAP-PHASE2.md` — gap analysis + dependency-ordered phasing
- [x] **FR-35** — GenBank + FASTA export (closed the one-way-import dead end)
- [x] **FR-36** — search across DNA / protein / features
- [x] **FR-34** — restriction enzyme engine (REBASE v608, 722 enzymes)
- [x] **FR-37** — primer model: nearest-neighbour Tm, 3'-anchored binding-site search, map arrows
- [x] Fixed the per-track "Align to File" buttons not carrying the cut band's offset
- [x] Published a logic-flow / feature board (3 SVG figures) — artifact + standalone files
- [x] Tests: 92 → 196

---

## 🔄 In Progress (Exact Resume Point)
**Branch:** `main`
**Last commit:** `4cf8122 FR-37: primer model, nearest-neighbour Tm, and binding-site search`
**Next immediate action:** Nothing is half-finished. Working tree is clean; lint, `tsc -b`, 196
tests and `npm run build` are all green. `main` is **ahead of `origin/main`** — FR-37 is not
pushed yet, and the live site does not have it. Resume by pushing, then starting FR-38.

---

## 📋 Remaining Work
1. **Push `main`** — FR-37 is committed locally only. Then redeploy (see item 2).
2. **User action outstanding:** add a `CLOUDFLARE_API_TOKEN` secret under repo Settings →
   Secrets → Actions so CI can deploy. Until then the deploy step **skips cleanly** and deploys
   are manual: `npx wrangler pages deploy dist --project-name plasmidviewer --branch main`.
   Token: Cloudflare → My Profile → API Tokens, permission `Account → Cloudflare Pages → Edit`.
   Claude deliberately does not handle tokens.
3. **FR-38 PCR** → FR-39 primer design. FR-38 is the next unit of work.
4. FR-49 gel simulation — needs only FR-38 now; FR-34 and FR-37 are both in.
5. FR-31/32/33 document model, history, editing UI — gates all of Phase 2.3 (cloning).
6. Optional: the header overlaps at viewport widths below ~700 px (fixed 300 px sidebar +
   `flexShrink: 0` button group). Pre-existing, unrelated to this session's changes.

---

## 🏗 Architecture Decisions Made
| Decision | Rationale | Date |
|----------|-----------|------|
| Keep the no-backend constraint | Enzymes, primers, PCR, gels and all 8 cloning methods are pure computation over short sequences and run fine client-side. Only MSA (Clustal/MAFFT/MUSCLE/T-Coffee) and CAP3 resist it — ship our own aligner instead of the brand names, preserving the privacy story | 2026-08-08 |
| Cloudflare Pages + Access, not client-side OAuth | A login screen in a static SPA gates the UI, not the files — the bundle was fetchable with a bare `curl`. Access enforces at the edge before any byte is served. Verified: every path 302s, including deep/nonexistent ones | 2026-08-08 |
| GitHub Pages disabled | It served the identical bundle unprotected, defeating Access entirely | 2026-08-08 |
| `base: './'` in vite config | Site is served as a project page under a subpath; the default absolute `/` base 404s every asset. Relative also keeps `npm run dev` at `/` | 2026-08-08 |
| Enzyme dataset generated by a committed script | `scripts/build-enzymes.mjs` regenerates from REBASE, so the set is reproducible rather than a hand-pasted blob | 2026-08-09 |
| Exclude REBASE putative enzymes | ~350 have a predicted recognition site but **unknown cut position**; including them would draw cut marks for cuts that do not happen. 722 of 1069 kept | 2026-08-09 |
| Lazy-load large data (parsers, enzymes) | Same treatment for both: initial bundle stays ~470 kB; enzymes are a separate 72 kB chunk (8.7 kB gz) fetched on first panel open | 2026-08-09 |
| Cut positions are indices *into* the site, unclamped | Makes type IIS (BsaI `GGTCTC` 7/11, cutting outside its own site) fall out of the same code path rather than being a special case. FR-42 Golden Gate depends on this | 2026-08-09 |
| One CI workflow, not two | `deploy.yml` split had reintroduced duplicated lint/test/build on every push; merged with a conditional deploy step | 2026-08-09 |
| Primer binding is 3'-anchored, not full-length | A cloning primer's 5' tail pairs with nothing, so a whole-length search finds the primer nowhere. Reporting the annealing region plus a `tailLength` is what FR-41 needs later too — for homology assembly the tail *is* the overlap | 2026-08-09 |
| Tm returns `NaN` for ambiguity codes | There are no stacking parameters for N/R/Y; a plausible number nothing supports is worse than an honest blank. Same principle as `translateCodon`'s 'X' | 2026-08-09 |
| Tm is quoted for the annealing region, not the oligo | The tail contributes nothing in the first cycle, so the whole-oligo Tm is the wrong number to anneal at. Both are shown — oligo in the list, region on the site | 2026-08-09 |
| An interior mismatch ends the anneal by default | With `maxMismatches: 0` the rest of the oligo simply becomes tail, which is the honest reading. Opting into 1 mismatch reads through — that is how a mutagenic primer binds, and FR-48 will want it | 2026-08-09 |
| `normalisePosition` moved to `utils/sequence` | Primers and PCR need the same circular wrap as cut positions; re-exported from `utils/enzymes` so existing callers and tests are untouched | 2026-08-09 |

---

## 🔧 Commands to Resume
```bash
# On any machine after git pull:
git pull origin main
bash scripts/session_sync.sh --load

# In Claude Code:
# /context-health     — verify hooks are wired
# /handover           — review this file
# /token-status       — check context usage
```

Project-specific:
```bash
npm run dev                        # dev server on :5173
npm test                           # vitest — 196 tests
npm run lint && npx tsc -b         # both clean as of 4cf8122
npm run build                      # tsc -b && vite build
node scripts/build-enzymes.mjs     # regenerate REBASE dataset (rarely needed)
npx wrangler pages deploy dist --project-name plasmidviewer --branch main
```

---

## 📁 Files Modified — FR-37
| File | Status |
|------|--------|
| src/models/primer.ts | added — Primer, BindingSite, Tm conditions |
| src/utils/primers.ts, primers.test.ts | added — NN Tm + 3'-anchored binding-site walk, 30 tests |
| src/components/PrimerPanel.tsx | added — oligo entry, stats, site list |
| src/components/PrimerBindings.tsx | added — map arrows, head on the 3' end, dashed tail |
| src/utils/sequence.ts | modified — gained `normalisePosition` |
| src/utils/enzymes.ts | modified — re-exports it from there |
| src/components/PlasmidViewer.tsx | modified — primer band, panel wiring, band offset fix |
| docs/ROADMAP-PHASE2.md, README.md | modified — gap analysis refreshed, usage documented |

---

## 🌿 Git Context
```
Branch  : main
Commit  : 4cf8122 FR-37: primer model, nearest-neighbour Tm, and binding-site search
Status  : clean (0 dirty files) — AHEAD of origin/main, not yet pushed
```

Recent commits:
```
4cf8122 FR-37: primer model, nearest-neighbour Tm, and binding-site search
7fa9035 docs: session handover after FR-34
a6f510f FR-34: restriction enzyme engine
f10cd50 CI: merge the deploy workflow in and repoint it at Cloudflare
ecba681 FR-36: search across sequence, protein, and features
```

---

## ⚠️ Critical Rules
- Never commit secrets or API keys — `CLOUDFLARE_API_TOKEN` belongs in GitHub repo secrets,
  created by the user, never handled by Claude.
- Run /handover before switching devices.
- **Deployment:** the live site is <https://plasmidviewer.pages.dev> behind Cloudflare Access
  (team domain `winter-math-714a.cloudflareaccess.com`, One-time PIN login). GitHub Pages is
  **disabled** and must stay that way — re-enabling it republishes the app unprotected.
- **Coordinates:** 1-based, inclusive at both ends, converted once in `src/parsers/teselagen.ts`.
  `src/parsers/serialize.ts` is the inverse and lives beside it deliberately.
- The repo is **public** while the deployment is access-controlled. Do not bundle anything that
  must not be publicly readable; user sequence data never leaves the browser (IndexedDB).

---

## 🧬 Bioinformatics Context
- **Enzyme data:** REBASE v608 (<http://rebase.neb.com>), © Dr. Richard J. Roberts. Attribution
  ships in the JSON payload, the enzyme panel footer, and the README — a condition of use.
- **Coordinate convention:** 1-based inclusive throughout; `length = end - start + 1`.
- **Genetic code:** NCBI translation table 1 only. Reverse-strand translation exists in search
  (6-frame) but the sequence track still shows 3 forward frames only.
- **Known engine subtleties worth not re-deriving:**
  - Minus-strand enzyme sites mirror as `siteStart + siteLength - k`; the enzyme's top-strand
    cut becomes the forward *bottom* cut. A minus-strand BsaI therefore cuts upstream.
  - Circular constructs wrap twice over: a site straddling the origin must be found, *and* a
    type IIS cut computed past either end must normalise back onto the circle.
  - Palindromes must be reported once, not once per strand — otherwise every fragment count
    doubles.
  - A cut's lower strand is the plain **complement** written 3'→5', not the reverse complement,
    so the mark sits at `cutBottom` directly. SmaI is `CCC^GGG / GGG^CCC`.
  - **Primers.** Tm is SantaLucia (1998) unified NN parameters with the entropic salt correction
    and the −1.4 symmetry term; defaults 0.25 µM primer, 50 mM Na⁺. Divalent cations and dNTP
    chelation are *not* modelled, so a Mg²⁺-heavy buffer reads a few degrees low.
  - Both strands walk outward from the primer's 3' base, so a reverse primer's 3' end sits at the
    **low** forward coordinate. That is what makes a facing primer pair readable on the map, and
    it is the coordinate FR-38 will extend from.
  - The 3'-most 3 bases must pair however tolerant the alignment is — a primer mismatched at its
    3' end does not prime at all.

---
_Auto-updated by `pre-compact.sh` hook and `/handover` skill._
_Read this at the start of every session. Update with `/handover`._
