import type {
    CodonChange, CodonConstraints, CodonHost, CodonTableDatabase, OptimisationResult,
    OptimisationStrategy, SequenceMetrics, Violation,
} from "../models/codon";
import type { Feature, Plasmid } from "../models/plasmid";
import { gcContent, reverseComplement, translateCodon, translateFrame } from "./sequence";
import { matchesAt } from "./search";

// ~37 kB, and only needed once the codon panel is opened — the same on-demand treatment the
// enzyme database and the GenBank parser get.
let cached: CodonTableDatabase | null = null;

export async function loadCodonTables(): Promise<CodonTableDatabase> {
    if (!cached) cached = (await import("../data/codonTables.json")).default as CodonTableDatabase;
    return cached;
}

/** The default rule set, which is roughly what a synthesis vendor will accept without querying. */
export const DEFAULT_CONSTRAINTS: CodonConstraints = {
    avoidSites: [],
    gcMin: 0.35,
    gcMax: 0.65,
    localWindow: 40,
    localGcMin: 0.30,
    localGcMax: 0.70,
    maxHomopolymer: 6,
    maxRepeat: 20,
    rareThreshold: 0.10,
};

const BASES = ["A", "C", "G", "T"] as const;

/** Every codon for each amino acid, built from the same translation table the viewer reads with. */
function buildSynonyms(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const a of BASES) {
        for (const b of BASES) {
            for (const c of BASES) {
                const codon = `${a}${b}${c}`;
                const aa = translateCodon(codon);
                const list = map.get(aa);
                if (list) list.push(codon); else map.set(aa, [codon]);
            }
        }
    }
    return map;
}

const SYNONYMS = buildSynonyms();

export function synonymousCodons(aa: string): string[] {
    return SYNONYMS.get(aa) ?? [];
}

/**
 * Relative adaptiveness w: a codon's frequency over the most frequent one for its amino acid.
 *
 * A codon that never appears in the table would drive the geometric mean to zero, so w is
 * floored — the convention when a reference set has an unobserved codon.
 */
const W_FLOOR = 0.01;

export function relativeAdaptiveness(host: CodonHost): Map<string, number> {
    const w = new Map<string, number>();

    for (const [aa, codons] of SYNONYMS) {
        if (aa === "X") continue;
        const best = Math.max(...codons.map(c => host.codons[c]?.fraction ?? 0));
        for (const codon of codons) {
            const fraction = host.codons[codon]?.fraction ?? 0;
            w.set(codon, best === 0 ? W_FLOOR : Math.max(fraction / best, W_FLOOR));
        }
    }

    return w;
}

/**
 * Codon adaptation index (Sharp & Li 1987): the geometric mean of w across the coding sequence.
 *
 * Single-codon families (Met, Trp) and stop codons are excluded, as they carry no synonymous
 * choice and would only pull the mean toward 1. Note the weights here come from genome-wide
 * codon usage, not from a reference set of highly expressed genes — so this is comparable
 * between two versions of the same gene, which is what it is used for, but it is not the same
 * number a CAI computed against a highly-expressed reference set would give.
 */
export function cai(sequence: string, host: CodonHost): number {
    const w = relativeAdaptiveness(host);
    let sum = 0;
    let n = 0;

    for (let i = 0; i + 3 <= sequence.length; i += 3) {
        const codon = sequence.slice(i, i + 3).toUpperCase();
        const aa = translateCodon(codon);
        if (aa === "X" || aa === "*" || synonymousCodons(aa).length < 2) continue;

        sum += Math.log(w.get(codon) ?? W_FLOOR);
        n++;
    }

    return n === 0 ? 0 : Math.exp(sum / n);
}

/** GC fraction at third codon positions, where synonymous choice is expressed. */
export function gc3(sequence: string): number {
    let gc = 0;
    let n = 0;

    for (let i = 2; i < sequence.length; i += 3) {
        const base = sequence[i].toUpperCase();
        if (base === "G" || base === "C") { gc++; n++; }
        else if (base === "A" || base === "T") { n++; }
    }

    return n === 0 ? 0 : gc / n;
}

export function longestHomopolymer(sequence: string): number {
    let best = 0;
    let run = 0;

    for (let i = 0; i < sequence.length; i++) {
        run = i > 0 && sequence[i] === sequence[i - 1] ? run + 1 : 1;
        if (run > best) best = run;
    }

    return best;
}

/** Where `motifs` occur in `sequence`, on either strand. 0-based offsets. */
export function findMotifs(sequence: string, motifs: string[]): { motif: string; offset: number }[] {
    const hits: { motif: string; offset: number }[] = [];

    for (const motif of motifs) {
        if (motif.length === 0 || motif.length > sequence.length) continue;
        const rc = reverseComplement(motif);
        const palindromic = rc === motif;

        for (let i = 0; i + motif.length <= sequence.length; i++) {
            if (matchesAt(sequence, motif, i) || (!palindromic && matchesAt(sequence, rc, i))) {
                hits.push({ motif, offset: i });
            }
        }
    }

    return hits.sort((a, b) => a.offset - b.offset);
}

export function measure(
    sequence: string, host: CodonHost, avoidSites: string[],
): SequenceMetrics {
    return {
        cai: cai(sequence, host),
        gc: gcContent(sequence),
        gc3: gc3(sequence),
        longestHomopolymer: longestHomopolymer(sequence),
        avoidedSiteHits: findMotifs(sequence, avoidSites).length,
    };
}

export interface OptimiseOptions {
    strategy: OptimisationStrategy;
    constraints: CodonConstraints;
    /** Sequence immediately 5' of the CDS in the construct. Read for constraint checks only —
     *  a forbidden site straddling the start codon is still a forbidden site. */
    upstream?: string;
    /** Sequence immediately 3' of the CDS, same purpose. */
    downstream?: string;
}

/** The state carried down the greedy pass. */
interface Context {
    host: CodonHost;
    w: Map<string, number>;
    constraints: CodonConstraints;
    upstream: string;
    /** Longest avoided motif, so we know how far back a new codon can complete one. */
    reach: number;
    /** Per-family running counts, for the `matched` strategy. */
    used: Map<string, number>;
}

/**
 * Orders the synonyms for one position best-first, before any constraint is applied.
 *
 * Every strategy is the same loop with a different comparator, which is why all three cost
 * roughly nothing to offer.
 */
function rankCandidates(
    aa: string, nativeCodon: string, strategy: OptimisationStrategy, ctx: Context,
): string[] {
    const codons = synonymousCodons(aa);
    const fraction = (c: string) => ctx.host.codons[c]?.fraction ?? 0;

    if (strategy === "rare-only") {
        // The native codon wins outright unless the host uses it rarely; only then does the
        // position open up to the usual frequency ranking.
        const nativeIsRare = fraction(nativeCodon) <= ctx.constraints.rareThreshold;
        const ranked = [...codons].sort((a, b) => fraction(b) - fraction(a) || a.localeCompare(b));
        if (!nativeIsRare && codons.includes(nativeCodon)) {
            return [nativeCodon, ...ranked.filter(c => c !== nativeCodon)];
        }
        return ranked;
    }

    if (strategy === "matched") {
        // Largest-deficit allocation: pick whichever codon is furthest below the share the host
        // would give it, counting what this run has already spent. Deterministic, and over a
        // whole CDS it converges on the host's distribution rather than its argmax.
        const spent = codons.reduce((sum, c) => sum + (ctx.used.get(c) ?? 0), 0);
        return [...codons].sort((a, b) => {
            const deficitA = fraction(a) * (spent + 1) - (ctx.used.get(a) ?? 0);
            const deficitB = fraction(b) * (spent + 1) - (ctx.used.get(b) ?? 0);
            return deficitB - deficitA || fraction(b) - fraction(a) || a.localeCompare(b);
        });
    }

    return [...codons].sort((a, b) => fraction(b) - fraction(a) || a.localeCompare(b));
}

/**
 * How badly appending `codon` breaks the rules — 0 when it breaks none.
 *
 * Only the tail of the sequence is examined: everything before it was checked when it was
 * appended, and everything after it is not written yet. Rules that only a finished sequence can
 * settle — global GC above all — are left to the repair pass.
 *
 * A graded cost rather than a yes/no, because some positions have no clean answer. When every
 * synonym breaks something, the optimiser still has to emit one, and it should emit the least
 * damaging: a forbidden site outweighs a homopolymer one base over its cap.
 */
function ruleCost(built: string, codon: string, ctx: Context): number {
    const { constraints: k } = ctx;
    const next = built + codon;
    // Constraint checks read through the upstream flank, so a motif spanning the start codon
    // is caught. Offsets below are into this padded string.
    const padded = ctx.upstream + next;
    const end = padded.length;
    let cost = 0;

    if (k.avoidSites.length > 0 && ctx.reach > 1) {
        // A new codon can only complete a motif that ends inside it.
        const from = Math.max(0, end - 3 - ctx.reach + 1);
        const window = padded.slice(from);
        for (const motif of k.avoidSites) {
            if (motif.length < 2) continue;
            const rc = reverseComplement(motif);
            for (let i = Math.max(0, window.length - 3 - motif.length + 1); i + motif.length <= window.length; i++) {
                if (matchesAt(window, motif, i) || matchesAt(window, rc, i)) cost += 100;
            }
        }
    }

    if (k.maxHomopolymer > 0) {
        // Every run the new codon could have lengthened ends at one of its three bases — not
        // necessarily at the last one, since a codon can close a run and then start another.
        let longest = 0;
        for (let j = end - 1; j >= Math.max(1, end - 3); j--) {
            let run = 1;
            for (let i = j; i > 0 && padded[i] === padded[i - 1]; i--) run++;
            if (run > longest) longest = run;
        }
        if (longest > k.maxHomopolymer) cost += longest - k.maxHomopolymer;
    }

    if (k.localWindow > 0 && next.length >= k.localWindow) {
        const window = next.slice(next.length - k.localWindow);
        const gc = gcContent(window);
        if (gc < k.localGcMin) cost += Math.ceil((k.localGcMin - gc) * 100);
        else if (gc > k.localGcMax) cost += Math.ceil((gc - k.localGcMax) * 100);
    }

    if (k.maxRepeat > 0 && next.length > k.maxRepeat) {
        // Does the just-completed tail already appear earlier? Catches the direct repeats that
        // make a sequence hard to synthesise and prone to recombining out.
        const tail = next.slice(next.length - k.maxRepeat);
        if (next.slice(0, next.length - 1).includes(tail)) cost += 50;
    }

    return cost;
}

/** One codon position during the search: its options, and how far through them we are. */
interface Slot {
    ranked: string[];
    pointer: number;
    /** A codon we cannot read has no synonyms, so it is placed as-is and never reconsidered. */
    fixed: boolean;
}

// Rule evaluations, not codons: a bound on the search rather than on the sequence. Reaching it
// drops the remaining positions to a single greedy pass, which always terminates.
const SEARCH_BUDGET = 50_000;

/**
 * Chooses a codon for every position, backing up when a choice paints the sequence into a corner.
 *
 * Pure greed is not enough here. Four lysines under a 4-base homopolymer cap is the smallest
 * case that shows it: AAA is the commoner codon and is legal as the first choice, but it leaves
 * a run that no second codon can extend legally, and the fix is to have picked AAG one position
 * earlier. So an exhausted position steps back and moves its predecessor on instead.
 */
function chooseCodons(
    sequence: string, strategy: OptimisationStrategy, ctx: Context,
): string[] {
    const count = Math.floor(sequence.length / 3);
    const slots: (Slot | undefined)[] = new Array(count);
    const placed: string[] = [];
    let built = "";
    let steps = 0;
    let i = 0;

    const place = (codon: string) => {
        placed.push(codon);
        built += codon;
        ctx.used.set(codon, (ctx.used.get(codon) ?? 0) + 1);
    };

    const unplace = () => {
        const codon = placed.pop()!;
        built = built.slice(0, -3);
        ctx.used.set(codon, (ctx.used.get(codon) ?? 0) - 1);
    };

    while (i < count) {
        if (!slots[i]) {
            const native = sequence.slice(i * 3, i * 3 + 3);
            const aa = translateCodon(native);
            slots[i] = aa === "X"
                ? { ranked: [native], pointer: 0, fixed: true }
                : { ranked: rankCandidates(aa, native, strategy, ctx), pointer: 0, fixed: false };
        }

        const slot = slots[i]!;
        let chosen: string | null = null;

        while (slot.pointer < slot.ranked.length) {
            const candidate = slot.ranked[slot.pointer];
            steps++;
            if (slot.fixed || ruleCost(built, candidate, ctx) === 0) { chosen = candidate; break; }
            slot.pointer++;
        }

        if (chosen !== null) {
            place(chosen);
            i++;
            continue;
        }

        // Nothing at this position is clean. Step back and let the previous position try its
        // next option — unless there is nowhere left to step back to, or the search has run
        // long enough, in which case settle for the least-bad codon and carry on.
        if (i === 0 || steps > SEARCH_BUDGET) {
            let best = slot.ranked[0];
            let bestCost = Infinity;
            for (const candidate of slot.ranked) {
                const cost = ruleCost(built, candidate, ctx);
                if (cost < bestCost) { bestCost = cost; best = candidate; }
            }
            place(best);
            i++;
            continue;
        }

        // Re-rank this position from scratch on the way back down: under `matched` its ordering
        // depends on what has been spent, and unwinding the predecessor changes that.
        slots[i] = undefined;
        i--;
        unplace();
        slots[i]!.pointer++;
    }

    return placed;
}

/** Every rule broken by a finished sequence, in coordinates within the CDS. */
function auditSequence(sequence: string, options: OptimiseOptions): Violation[] {
    const k = options.constraints;
    const violations: Violation[] = [];
    const up = options.upstream ?? "";
    const padded = up + sequence + (options.downstream ?? "");

    for (const { motif, offset } of findMotifs(padded, k.avoidSites)) {
        // Report against the CDS, but keep hits that only exist because of the flanks: those
        // are real sites in the construct, and the optimiser could not always avoid them.
        violations.push({
            kind: "site",
            start: offset - up.length + 1,
            end: offset - up.length + motif.length,
            detail: `${motif} at ${offset - up.length + 1}`,
        });
    }

    if (k.maxHomopolymer > 0) {
        let run = 1;
        for (let i = 1; i <= sequence.length; i++) {
            if (i < sequence.length && sequence[i] === sequence[i - 1]) { run++; continue; }
            if (run > k.maxHomopolymer) {
                violations.push({
                    kind: "homopolymer",
                    start: i - run + 1,
                    end: i,
                    detail: `${run}×${sequence[i - 1]} at ${i - run + 1}`,
                });
            }
            run = 1;
        }
    }

    if (k.localWindow > 0) {
        for (let i = 0; i + k.localWindow <= sequence.length; i++) {
            const gc = gcContent(sequence.slice(i, i + k.localWindow));
            if (gc < k.localGcMin || gc > k.localGcMax) {
                violations.push({
                    kind: "gc-window",
                    start: i + 1,
                    end: i + k.localWindow,
                    detail: `${(gc * 100).toFixed(0)}% GC over ${k.localWindow} nt at ${i + 1}`,
                });
                // One report per excursion rather than one per offset inside it.
                i += k.localWindow - 1;
            }
        }
    }

    const gc = gcContent(sequence);
    if (gc < k.gcMin || gc > k.gcMax) {
        violations.push({
            kind: "global-gc",
            detail: `${(gc * 100).toFixed(1)}% GC, outside `
                + `${(k.gcMin * 100).toFixed(0)}–${(k.gcMax * 100).toFixed(0)}%`,
        });
    }

    return violations;
}

const MAX_REPAIR_SWAPS = 400;

/**
 * Nudges global GC back into range after the greedy pass.
 *
 * The greedy pass can only see the window behind it, so a sequence can finish outside the global
 * bounds with every local rule met. Each round swaps the single codon that moves GC furthest in
 * the needed direction per unit of adaptiveness given up, so the cheapest edits happen first.
 */
function repairGlobalGc(
    codons: string[], options: OptimiseOptions, ctx: Context,
): void {
    const k = options.constraints;
    const gcOf = (c: string) => (c.match(/[GC]/g) ?? []).length;
    // Global GC is the thing being repaired, so it is excluded from both sides of the
    // comparison below — counting it would leave every trial looking no worse than the
    // current sequence and let a repair swap re-create a site the greedy pass avoided.
    const otherFaults = (sequence: string) =>
        auditSequence(sequence, options).filter(v => v.kind !== "global-gc").length;

    for (let round = 0; round < MAX_REPAIR_SWAPS; round++) {
        const sequence = codons.join("");
        const gc = gcContent(sequence);
        if (gc >= k.gcMin && gc <= k.gcMax) return;

        const wantMoreGc = gc < k.gcMin;
        const faultsNow = otherFaults(sequence);
        let best: { index: number; codon: string; score: number } | null = null;

        for (let i = 0; i < codons.length; i++) {
            const current = codons[i];
            const aa = translateCodon(current);
            const delta = wantMoreGc ? 1 : -1;

            for (const candidate of synonymousCodons(aa)) {
                if (candidate === current) continue;
                const moved = (gcOf(candidate) - gcOf(current)) * delta;
                if (moved <= 0) continue;

                // Cost is the adaptiveness surrendered; ties break toward the bigger GC move.
                const cost = (ctx.w.get(current) ?? 1) - (ctx.w.get(candidate) ?? 1);
                const score = moved / (cost + 0.05);
                if (best && score <= best.score) continue;

                const trial = [...codons];
                trial[i] = candidate;
                // A repair that introduces a forbidden site or a homopolymer is not a repair.
                if (otherFaults(trial.join("")) > faultsNow) continue;

                best = { index: i, codon: candidate, score };
            }
        }

        if (!best) return;
        codons[best.index] = best.codon;
    }
}

/**
 * Rewrites a coding sequence for a host's codon usage without changing the protein.
 *
 * The result is deterministic: the same CDS, host, strategy and constraints always give the same
 * sequence, so a construct can be regenerated from a notebook entry.
 */
export function optimiseCds(
    cds: string, host: CodonHost, options: OptimiseOptions,
): OptimisationResult {
    const sequence = cds.toUpperCase().replace(/U/g, "T");
    const k = options.constraints;

    const ctx: Context = {
        host,
        w: relativeAdaptiveness(host),
        constraints: k,
        upstream: (options.upstream ?? "").toUpperCase(),
        reach: k.avoidSites.reduce((max, s) => Math.max(max, s.length), 0),
        used: new Map(),
    };

    const codons = chooseCodons(sequence, options.strategy, ctx);
    repairGlobalGc(codons, options, ctx);

    // A codon we cannot read — an N, or anything else off the standard alphabet — has no
    // synonyms to choose between, so it is passed through untouched and counted here.
    let untouched = 0;
    const optimised = codons.join("");
    const changes: CodonChange[] = [];
    for (let i = 0; i + 3 <= optimised.length; i += 3) {
        const native = sequence.slice(i, i + 3);
        const now = optimised.slice(i, i + 3);
        if (translateCodon(native) === "X") untouched++;
        if (now !== native) {
            changes.push({ index: i / 3, nativeCodon: native, newCodon: now, aa: translateCodon(now) });
        }
    }

    // A trailing 1 or 2 bases cannot form a codon and are carried through untouched, so the
    // caller gets back a sequence of the same length as the one it passed in.
    const remainder = sequence.slice(codons.length * 3);

    return {
        sequence: optimised + remainder,
        changes,
        before: measure(sequence, host, k.avoidSites),
        after: measure(optimised + remainder, host, k.avoidSites),
        remaining: auditSequence(optimised + remainder, options),
        untouched,
    };
}

/** The protein a CDS encodes, used to assert an optimisation changed nothing that matters. */
export function proteinOf(cds: string): string {
    return translateFrame(cds.toUpperCase().replace(/U/g, "T"), 0).map(r => r.aa).join("");
}

/** `length` bases from 0-based `from`, wrapping the origin when the construct is circular. */
function sliceAround(sequence: string, from: number, length: number, circular: boolean): string {
    if (length <= 0) return "";

    if (!circular) {
        return sequence.slice(Math.max(0, from), Math.max(0, from + length));
    }

    const n = sequence.length;
    let out = "";
    for (let i = 0; i < length; i++) out += sequence[(((from + i) % n) + n) % n];
    return out;
}

export interface CdsRegion {
    feature: Feature;
    /** The coding sequence, 5'→3' on whichever strand codes. */
    sequence: string;
    /** Construct sequence immediately 5' of the CDS, on the coding strand. */
    upstream: string;
    /** Construct sequence immediately 3' of the CDS, on the coding strand. */
    downstream: string;
    /** True when the length is not a whole number of codons — usually a partial annotation. */
    partial: boolean;
}

const FLANK = 30;

/**
 * The coding sequences a construct annotates, ready to optimise.
 *
 * A minus-strand CDS is returned reverse-complemented, so it reads as a protein does, and its
 * flanks are swapped to match — the bases 5' of a minus-strand gene sit *after* it on the
 * forward sequence. Both are what the constraint checks need to see a forbidden site that only
 * exists across the junction with the vector.
 */
export function cdsRegions(plasmid: Plasmid, flank: number = FLANK): CdsRegion[] {
    const circular = plasmid.topology === "circular";
    const n = plasmid.length;

    return plasmid.features
        .filter(f => f.type === "CDS")
        .map(feature => {
            // A feature that wraps the origin has start > end, and spans to the end and back.
            const span = feature.end >= feature.start
                ? feature.end - feature.start + 1
                : n - feature.start + 1 + feature.end;

            const forward = sliceAround(plasmid.sequence, feature.start - 1, span, circular);
            const before = sliceAround(plasmid.sequence, feature.start - 1 - flank, flank, circular);
            const after = sliceAround(plasmid.sequence, feature.start - 1 + span, flank, circular);

            const minus = feature.strand === "-";
            return {
                feature,
                sequence: minus ? reverseComplement(forward) : forward,
                upstream: minus ? reverseComplement(after) : before,
                downstream: minus ? reverseComplement(before) : after,
                partial: span % 3 !== 0,
            };
        });
}
