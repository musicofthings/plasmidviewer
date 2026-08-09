import type { Strand } from "./plasmid";

/**
 * An oligonucleotide, written 5'->3' the way it would be ordered.
 *
 * A primer is *not* a subsequence of the construct: a cloning primer usually carries a 5' tail
 * (a restriction site, an overlap for assembly, a tag) that anneals to nothing. Only the 3'
 * portion binds, and that distinction drives everything below — the binding site, the Tm that
 * matters for the anneal step, and eventually the product FR-38 will amplify.
 */
export interface Primer {
    id: string;
    name: string;
    /** 5'->3', uppercase. May include a 5' tail that does not anneal. */
    sequence: string;
    /** Set when the primer was read from a `primer_bind` annotation rather than typed. */
    fromFeatureId?: string;
}

/** Conditions the nearest-neighbour Tm is computed under. Defaults are ordinary PCR. */
export interface TmConditions {
    /** Total primer strand concentration, molar. 0.25 µM is a typical 25 µL reaction. */
    primerMolar: number;
    /** Monovalent cation concentration, molar. */
    sodiumMolar: number;
}

export const DEFAULT_TM_CONDITIONS: TmConditions = {
    primerMolar: 0.25e-6,
    sodiumMolar: 0.05,
};

/**
 * Where a primer anneals, and how well.
 *
 * `strand` is the direction the polymerase would extend in: "+" runs toward higher coordinates,
 * "-" toward lower ones. For a "-" site the primer's 3' end therefore sits at `start`, not `end`.
 */
export interface BindingSite {
    primerId: string;
    /** 1-based inclusive bounds of the *annealing* region on the forward sequence.
     *  `start > end` when the region crosses the origin of a circular construct. */
    start: number;
    end: number;
    strand: Strand;
    /** 1-based position of the primer's 3' base — where extension begins. */
    threePrime: number;
    /** Length of the annealing region; `primer.sequence.length - tailLength`. */
    annealLength: number;
    /** 5' bases that do not anneal — a cloning tail, or simply overhanging the end. */
    tailLength: number;
    /** Mismatches inside the annealing region. The 3' end is always an exact match. */
    mismatches: number;
    /** Tm of the annealing region only, in °C — the tail contributes nothing to the first cycle. */
    tm: number;
    wraps: boolean;
}
