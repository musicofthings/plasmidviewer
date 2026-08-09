import type { Plasmid, Strand } from "../models/plasmid";
import {
    DEFAULT_TM_CONDITIONS, type BindingSite, type Primer, type TmConditions,
} from "../models/primer";
import { iupacMask } from "./search";
import { complementBase, normalisePosition, reverseComplement } from "./sequence";

/**
 * Unified nearest-neighbour parameters — SantaLucia, PNAS 95:1460 (1998), Table 1.
 * `[ΔH kcal/mol, ΔS cal/(mol·K)]` for each dinucleotide step read 5'->3' on one strand.
 *
 * Both readings of a step are listed rather than reverse-complementing at lookup time: AA and
 * TT are the same stack seen from either strand, and writing that out makes the table
 * checkable against the paper line by line.
 */
const NEAREST_NEIGHBOUR: Record<string, [number, number]> = {
    AA: [-7.9, -22.2], TT: [-7.9, -22.2],
    AT: [-7.2, -20.4],
    TA: [-7.2, -21.3],
    CA: [-8.5, -22.7], TG: [-8.5, -22.7],
    GT: [-8.4, -22.4], AC: [-8.4, -22.4],
    CT: [-7.8, -21.0], AG: [-7.8, -21.0],
    GA: [-8.2, -22.2], TC: [-8.2, -22.2],
    CG: [-10.6, -27.2],
    GC: [-9.8, -24.4],
    GG: [-8.0, -19.9], CC: [-8.0, -19.9],
};

// Helix initiation, applied once per end and depending on which base pair terminates there.
const INIT_GC: [number, number] = [0.1, -2.8];
const INIT_AT: [number, number] = [2.3, 4.1];

/** Entropic penalty for a self-complementary duplex, which loses a symmetry degree of freedom. */
const SYMMETRY_DS = -1.4;

/** Gas constant, cal/(mol·K) — the units ΔS is tabulated in. */
const R = 1.987;

const KELVIN_OFFSET = 273.15;

/**
 * Melting temperature in °C by nearest-neighbour thermodynamics.
 *
 * Returns `NaN` rather than a guess when the sequence is shorter than one stack or contains
 * anything but A/C/G/T: an ambiguity code has no stacking parameters, and inventing one would
 * put a plausible number on screen that nothing supports.
 *
 * Salt correction is SantaLucia's entropic form, ΔS + 0.368·(N−1)·ln[Na⁺]. Divalent cations and
 * dNTP chelation are not modelled, so a Mg²⁺-heavy buffer reads a few degrees low.
 */
export function meltingTemp(
    sequence: string,
    conditions: TmConditions = DEFAULT_TM_CONDITIONS,
): number {
    const clean = sequence.replace(/\s/g, "").toUpperCase();
    if (clean.length < 2 || !/^[ACGT]+$/.test(clean)) return NaN;

    let dH = 0;
    let dS = 0;

    for (let i = 0; i + 1 < clean.length; i++) {
        const [stepH, stepS] = NEAREST_NEIGHBOUR[clean.slice(i, i + 2)];
        dH += stepH;
        dS += stepS;
    }

    for (const terminal of [clean[0], clean[clean.length - 1]]) {
        const [initH, initS] = terminal === "G" || terminal === "C" ? INIT_GC : INIT_AT;
        dH += initH;
        dS += initS;
    }

    // A self-complementary oligo anneals to itself, so both the symmetry term and the
    // concentration divisor change.
    const selfComplementary = reverseComplement(clean) === clean;
    if (selfComplementary) dS += SYMMETRY_DS;

    dS += 0.368 * (clean.length - 1) * Math.log(conditions.sodiumMolar);

    // Non-self-complementary strands present at equal concentration make CT/4 the effective term.
    const effectiveConcentration = conditions.primerMolar / (selfComplementary ? 1 : 4);

    return (dH * 1000) / (dS + R * Math.log(effectiveConcentration)) - KELVIN_OFFSET;
}

export interface BindingOptions {
    /** Shortest annealing region reported. Below ~12 nt an anneal is not specific enough to matter. */
    minAnneal: number;
    /** Mismatches tolerated inside the annealing region — all of them 5' of the anchor. */
    maxMismatches: number;
    conditions: TmConditions;
}

export const DEFAULT_BINDING_OPTIONS: BindingOptions = {
    minAnneal: 12,
    maxMismatches: 0,
    conditions: DEFAULT_TM_CONDITIONS,
};

/**
 * The polymerase extends from the 3' hydroxyl, so these bases must pair however tolerant the
 * rest of the alignment is. A primer mismatched at its final base does not prime.
 */
const THREE_PRIME_EXACT = 3;

interface Anneal {
    length: number;
    mismatches: number;
}

/**
 * Walks 5'-wards from the primer's 3' base at `p3`, returning the longest annealing region.
 *
 * `strand` is the extension direction: "+" reads the template toward lower indices as it walks
 * back from the 3' end, "-" toward higher ones, since a reverse primer's 3' end sits at the
 * *low* forward coordinate.
 */
function anneal(
    haystack: string, probe: string, strand: Strand, p3: number,
    minAnneal: number, maxMismatches: number,
): Anneal | null {
    const n = probe.length;
    let mismatches = 0;
    let best: Anneal | null = null;

    for (let k = 0; k < n; k++) {
        const index = strand === "+" ? p3 - k : p3 + k;
        if (index < 0 || index >= haystack.length) break;

        // A forward primer reads the template's top strand directly; a reverse primer reads the
        // bottom strand, which is the complement of what the forward sequence spells.
        const templateBase = strand === "+" ? haystack[index] : complementBase(haystack[index]);

        if ((iupacMask(templateBase) & iupacMask(probe[n - 1 - k])) === 0) {
            if (k < THREE_PRIME_EXACT) return null;
            if (++mismatches > maxMismatches) break;
            continue;
        }

        // Recorded only on a match, so an annealing region can never start on a mismatched base.
        if (k + 1 >= minAnneal) best = { length: k + 1, mismatches };
    }

    return best;
}

/**
 * Every place `primer` anneals well enough to prime, on both strands.
 *
 * The match is 3'-anchored rather than full-length: a cloning primer's 5' tail — a restriction
 * site, an assembly overlap, a tag — pairs with nothing, and a whole-sequence search would miss
 * the primer entirely. What is reported is the annealing region, and `tailLength` says how much
 * of the oligo hung off the front.
 *
 * On a circular construct the walk continues across the origin in both directions.
 */
export function findBindingSites(
    plasmid: Plasmid, primer: Primer, options: Partial<BindingOptions> = {},
): BindingSite[] {
    const { minAnneal, maxMismatches, conditions } = { ...DEFAULT_BINDING_OPTIONS, ...options };

    const sequence = plasmid.sequence.toUpperCase();
    const length = sequence.length;
    const probe = primer.sequence.replace(/\s/g, "").toUpperCase();

    if (probe.length === 0 || length === 0 || minAnneal > probe.length) return [];

    const circular = plasmid.topology === "circular";
    // A forward primer walks back from its 3' base and a reverse primer walks forward, so on a
    // circle each needs a whole extra copy of the sequence in the direction it reads.
    const haystack = circular ? sequence + sequence : sequence;

    const sites: BindingSite[] = [];

    for (const strand of ["+", "-"] as const) {
        // Anchor the scan so that every forward position is the 3' end exactly once: a forward
        // primer starts in the second copy so it can read back across the origin.
        const from = circular && strand === "+" ? length : 0;

        for (let p3 = from; p3 < from + length; p3++) {
            const found = anneal(haystack, probe, strand, p3, minAnneal, maxMismatches);
            if (!found) continue;

            const rawLow = strand === "+" ? p3 - found.length + 1 : p3;
            const rawHigh = strand === "+" ? p3 : p3 + found.length - 1;
            const start = normalisePosition(rawLow + 1, length);
            const end = normalisePosition(rawHigh + 1, length);

            sites.push({
                primerId: primer.id,
                start,
                end,
                strand,
                threePrime: normalisePosition(p3 + 1, length),
                annealLength: found.length,
                tailLength: probe.length - found.length,
                mismatches: found.mismatches,
                // The Tm of the primer's own annealing bases. Mismatches destabilise the duplex
                // and are not penalised here, so a mismatched site reads slightly high.
                tm: meltingTemp(probe.slice(probe.length - found.length), conditions),
                wraps: end < start,
            });
        }
    }

    return sites.sort((a, b) => a.start - b.start || a.strand.localeCompare(b.strand));
}

/** Binding sites for several primers at once, ordered along the sequence. */
export function findAllBindingSites(
    plasmid: Plasmid, primers: Primer[], options: Partial<BindingOptions> = {},
): BindingSite[] {
    return primers
        .flatMap(primer => findBindingSites(plasmid, primer, options))
        .sort((a, b) => a.start - b.start || a.strand.localeCompare(b.strand));
}

/** A feature's sequence read 5'->3' along its own strand, wrapping the origin if it has to. */
function orientedSlice(sequence: string, start: number, end: number, strand: Strand): string {
    const forward = end >= start
        ? sequence.slice(start - 1, end)
        : sequence.slice(start - 1) + sequence.slice(0, end);
    return strand === "-" ? reverseComplement(forward) : forward;
}

/**
 * The primers a construct already carries.
 *
 * GenBank and SnapGene files record used primers as `primer_bind` annotations, which the viewer
 * has always drawn but never treated as oligos. Reading them back out means an imported
 * construct arrives with its primer set intact instead of needing them retyped.
 *
 * The recovered sequence is necessarily the perfect-match region only — an annotation records
 * where the primer sat, not the tail that hung off it.
 */
export function primersFromFeatures(plasmid: Plasmid): Primer[] {
    return plasmid.features
        .filter(feature => (feature.rawType ?? "").toLowerCase() === "primer_bind")
        .map(feature => ({
            id: `feature:${feature.id}`,
            name: feature.name,
            sequence: orientedSlice(plasmid.sequence, feature.start, feature.end, feature.strand)
                .toUpperCase(),
            fromFeatureId: feature.id,
        }))
        .filter(primer => primer.sequence.length > 0);
}

/** GC as a percentage of the whole oligo, 0 when it is empty. */
export function primerGcPercent(sequence: string): number {
    const clean = sequence.replace(/\s/g, "").toUpperCase();
    if (clean.length === 0) return 0;

    let gc = 0;
    for (const base of clean) if (base === "G" || base === "C") gc++;
    return (gc / clean.length) * 100;
}

/**
 * Whether the 3' end has a GC clamp: one to three G/C in the last five bases.
 *
 * None and the primer frays where it needs to be held down; four or five and it mispriming
 * anywhere GC-rich becomes likely. This is a design heuristic, not a hard rule.
 */
export function hasGcClamp(sequence: string): boolean {
    const tail = sequence.replace(/\s/g, "").toUpperCase().slice(-5);
    const gc = [...tail].filter(base => base === "G" || base === "C").length;
    return gc >= 1 && gc <= 3;
}

/** A compact description of where a primer sits, for the panel's result list. */
export function describeBindingSite(site: BindingSite): string {
    const arrow = site.strand === "+" ? "→" : "←";
    const range = site.wraps ? `${site.start}..${site.end} (wraps origin)` : `${site.start}..${site.end}`;
    const tail = site.tailLength > 0 ? ` · ${site.tailLength} nt tail` : "";
    const mismatches = site.mismatches > 0
        ? ` · ${site.mismatches} mismatch${site.mismatches === 1 ? "" : "es"}`
        : "";
    return `${arrow} ${range}${tail}${mismatches}`;
}
