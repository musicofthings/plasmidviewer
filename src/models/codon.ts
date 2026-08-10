/** One codon's share of its synonymous family, and its rate across the whole genome. */
export interface CodonUsage {
    /** Fraction of this amino acid's codons that are this one. A family sums to 1. */
    fraction: number;
    /** Occurrences per thousand codons — the figure codon tables are usually printed in. */
    perThousand: number;
}

/** A codon usage table for one expression host, as built by scripts/build-codon-tables.mjs. */
export interface CodonHost {
    id: string;
    /** Short display name, e.g. "E. coli K-12". */
    name: string;
    note: string;
    taxid: number;
    /** The organism string Kazusa reports, e.g. "Escherichia coli W3110". */
    source: string;
    /** How many coding sequences the table was counted from. Three of the hosts rest on very
     *  few genes, and a user choosing one deserves to know that before trusting it. */
    cdsCount: number;
    codonCount: number;
    /** All 64 codons, DNA alphabet. */
    codons: Record<string, CodonUsage>;
}

export interface CodonTableDatabase {
    retrieved: string;
    source: string;
    url: string;
    hosts: CodonHost[];
}

/**
 * How a synonymous codon is chosen.
 *
 * - `highest` — always the host's most frequent synonym. Maximises CAI, and is what most
 *   commercial gene-synthesis "optimisation" does. It also flattens codon diversity, which is
 *   the usual explanation for why a maximally optimised gene sometimes expresses worse.
 * - `matched` — reproduce the host's codon *distribution* rather than its argmax, so a codon
 *   used 30% of the time in the host is used about 30% of the time here.
 * - `rare-only` — keep the native codon unless it is rare in the host, then swap it. The
 *   smallest edit that fixes the actual problem, and it leaves native sequence intact.
 */
export type OptimisationStrategy = "highest" | "matched" | "rare-only";

export interface CodonConstraints {
    /** Motifs to keep out of the result, IUPAC allowed, checked on both strands. */
    avoidSites: string[];
    /** Global GC bounds as fractions. */
    gcMin: number;
    gcMax: number;
    /** Sliding-window width in nt for the local GC check; 0 disables it. */
    localWindow: number;
    localGcMin: number;
    localGcMax: number;
    /** Longest run of one base allowed; 0 disables the check. */
    maxHomopolymer: number;
    /** Longest exact direct repeat allowed; 0 disables the check. */
    maxRepeat: number;
    /** Under `rare-only`, the family fraction at or below which a codon counts as rare. */
    rareThreshold: number;
}

export interface CodonChange {
    /** 0-based codon index within the CDS. */
    index: number;
    nativeCodon: string;
    newCodon: string;
    aa: string;
}

export type ViolationKind = "site" | "homopolymer" | "gc-window" | "repeat" | "global-gc";

/** A constraint the optimiser could not satisfy, reported rather than silently dropped. */
export interface Violation {
    kind: ViolationKind;
    /** 1-based inclusive bounds within the CDS. Absent for whole-sequence findings. */
    start?: number;
    end?: number;
    detail: string;
}

export interface SequenceMetrics {
    /** Codon adaptation index against the chosen host. */
    cai: number;
    gc: number;
    /** GC at third codon positions — where synonymous choice actually shows up. */
    gc3: number;
    longestHomopolymer: number;
    /** Occurrences of the avoided motifs, both strands. */
    avoidedSiteHits: number;
}

export interface OptimisationResult {
    /** The optimised CDS, 5'→3' on the coding strand. */
    sequence: string;
    changes: CodonChange[];
    before: SequenceMetrics;
    after: SequenceMetrics;
    /** Constraints still broken after the repair pass. Empty means every rule was met. */
    remaining: Violation[];
    /** Codons left alone because they could not be read, e.g. they contain an N. */
    untouched: number;
}
