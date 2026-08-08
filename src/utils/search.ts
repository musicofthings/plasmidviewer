import type { Feature, Plasmid, Strand } from "../models/plasmid";
import { reverseComplement, translateFrame } from "./sequence";

export type SearchKind = "dna" | "protein" | "feature";

export interface SearchHit {
    kind: SearchKind;
    /** 1-based inclusive. For a hit that crosses the origin of a circular construct,
     *  `start > end` — the same convention GenBank's join() uses. */
    start: number;
    end: number;
    strand: Strand;
    /** The matched text, for display in the result list. */
    match: string;
    /** True when the hit runs past the end of a circular sequence and resumes at base 1. */
    wraps: boolean;
    /** Reading frame 1..3 (on `strand`), for protein hits only. */
    frame?: number;
    /** The matched feature, for feature hits only. */
    feature?: Feature;
}

// IUPAC codes as 4-bit sets, so "does this position match" is one bitwise AND. A query base
// matches a subject base whenever their sets intersect — so a degenerate primer (N, R, Y…)
// finds concrete sequence, and a concrete query still finds a degenerate subject.
const A = 1, C = 2, G = 4, T = 8;
const IUPAC: Record<string, number> = {
    A, C, G, T, U: T,
    R: A | G, Y: C | T, S: G | C, W: A | T, K: G | T, M: A | C,
    B: C | G | T, D: A | G | T, H: A | C | T, V: A | C | G,
    N: A | C | G | T,
};

export function iupacMask(base: string): number {
    return IUPAC[base.toUpperCase()] ?? 0;
}

/** True when every base of `query` is compatible with `sequence` starting at `offset` (0-based). */
export function matchesAt(sequence: string, query: string, offset: number): boolean {
    for (let i = 0; i < query.length; i++) {
        // An unrecognised character on either side has an empty set and can never match,
        // which is what we want for junk input rather than a silent wildcard.
        if ((iupacMask(sequence[offset + i]) & iupacMask(query[i])) === 0) return false;
    }
    return true;
}

/** Scans one strand, returning 0-based start offsets. */
function scan(haystack: string, query: string, limit: number): number[] {
    const found: number[] = [];
    for (let i = 0; i + query.length <= haystack.length && i < limit; i++) {
        if (matchesAt(haystack, query, i)) found.push(i);
    }
    return found;
}

function dnaHit(
    offset: number, length: number, sequenceLength: number, strand: Strand, match: string,
): SearchHit {
    const start = offset + 1;
    const rawEnd = offset + length;
    const wraps = rawEnd > sequenceLength;
    return {
        kind: "dna",
        start,
        end: wraps ? rawEnd - sequenceLength : rawEnd,
        strand,
        match,
        wraps,
    };
}

/**
 * Finds a nucleotide motif on both strands.
 *
 * On a circular construct the search continues past the end and back to base 1, so a site
 * spanning the origin is found rather than silently missed — the usual reason a cut site
 * "disappears" in tools that treat every sequence as linear.
 */
export function findDnaMatches(plasmid: Plasmid, query: string): SearchHit[] {
    const clean = query.replace(/\s/g, "").toUpperCase();
    if (clean.length === 0) return [];

    const { sequence, topology } = plasmid;
    const len = sequence.length;
    if (clean.length > len) return [];

    // Extending by query-1 bases lets a match run over the origin; capping the scan at `len`
    // keeps the extension from reporting the same site twice.
    const haystack = topology === "circular" ? sequence + sequence.slice(0, clean.length - 1) : sequence;

    const hits: SearchHit[] = [];
    for (const offset of scan(haystack, clean, len)) {
        hits.push(dnaHit(offset, clean.length, len, "+", haystack.slice(offset, offset + clean.length)));
    }

    // A palindrome matches itself on both strands; reporting it twice would be noise.
    const revQuery = reverseComplement(clean);
    if (revQuery !== clean) {
        for (const offset of scan(haystack, revQuery, len)) {
            hits.push(dnaHit(offset, clean.length, len, "-", haystack.slice(offset, offset + clean.length)));
        }
    }

    return hits.sort(byPosition);
}

/**
 * Finds a peptide across all six reading frames.
 *
 * Frames are anchored to the sequence, not to the viewport, so a hit's nucleotide
 * coordinates are exact and can be revealed on the map like any other selection.
 */
export function findProteinMatches(plasmid: Plasmid, query: string): SearchHit[] {
    const peptide = query.replace(/\s/g, "").toUpperCase();
    if (peptide.length === 0) return [];

    const { sequence } = plasmid;
    const len = sequence.length;
    const hits: SearchHit[] = [];

    for (const strand of ["+", "-"] as const) {
        const strandSeq = strand === "+" ? sequence : reverseComplement(sequence);

        for (const frame of [0, 1, 2] as const) {
            const residues = translateFrame(strandSeq, frame);
            const protein = residues.map(r => r.aa).join("");

            for (let i = protein.indexOf(peptide); i !== -1; i = protein.indexOf(peptide, i + 1)) {
                // Codon bounds within strandSeq, 1-based inclusive.
                const from = residues[i].startBp;
                const to = residues[i + peptide.length - 1].endBp;

                hits.push({
                    kind: "protein",
                    // Reverse-strand coordinates are measured along the reverse complement,
                    // so mirror them back onto the forward sequence the map is drawn in.
                    start: strand === "+" ? from : len - to + 1,
                    end: strand === "+" ? to : len - from + 1,
                    strand,
                    match: peptide,
                    wraps: false,
                    frame: frame + 1,
                });
            }
        }
    }

    return hits.sort(byPosition);
}

/** Matches a feature's name, type, or description, case-insensitively. */
export function findFeatureMatches(features: Feature[], query: string): SearchHit[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    return features
        .filter(f =>
            f.name.toLowerCase().includes(needle) ||
            (f.rawType ?? f.type).toLowerCase().includes(needle) ||
            (f.description ?? "").toLowerCase().includes(needle))
        .map(f => ({
            kind: "feature" as const,
            start: f.start,
            end: f.end,
            strand: f.strand,
            match: f.name,
            wraps: false,
            feature: f,
        }))
        .sort(byPosition);
}

function byPosition(a: SearchHit, b: SearchHit): number {
    return a.start - b.start || a.end - b.end || a.strand.localeCompare(b.strand);
}

/**
 * Guesses what the user typed, so the search box does not need a mode selector for the
 * common cases. Anything that is only nucleotide codes is treated as DNA.
 */
export function detectSearchKind(query: string): SearchKind {
    const clean = query.replace(/\s/g, "").toUpperCase();
    if (clean.length === 0) return "dna";
    return /^[ACGTURYSWKMBDHVN]+$/.test(clean) ? "dna" : "protein";
}

/** A compact description of where a hit is, for the result list. */
export function describeHit(hit: SearchHit): string {
    const strand = hit.strand === "+" ? "→" : "←";
    const range = hit.wraps ? `${hit.start}..${hit.end} (wraps origin)` : `${hit.start}..${hit.end}`;
    const frame = hit.frame ? ` · frame ${hit.strand}${hit.frame}` : "";
    return `${strand} ${range}${frame}`;
}

export function searchPlasmid(plasmid: Plasmid, query: string, kind: SearchKind): SearchHit[] {
    switch (kind) {
        case "dna": return findDnaMatches(plasmid, query);
        case "protein": return findProteinMatches(plasmid, query);
        case "feature": return findFeatureMatches(plasmid.features, query);
    }
}
