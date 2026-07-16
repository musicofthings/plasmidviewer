const COMPLEMENT: Record<string, string> = {
    A: "T", T: "A", G: "C", C: "G",
    // IUPAC ambiguity codes, so a complement never silently drops a base.
    U: "A", R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
    B: "V", V: "B", D: "H", H: "D", N: "N",
};

export function complementBase(base: string): string {
    return COMPLEMENT[base.toUpperCase()] ?? "N";
}

export function complement(sequence: string): string {
    let out = "";
    for (const base of sequence) out += complementBase(base);
    return out;
}

export function reverseComplement(sequence: string): string {
    let out = "";
    for (let i = sequence.length - 1; i >= 0; i--) out += complementBase(sequence[i]);
    return out;
}

// Standard genetic code (NCBI translation table 1). '*' is a stop codon.
const CODONS: Record<string, string> = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L",
    CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T",
    GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K",
    GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W",
    CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

export function translateCodon(codon: string): string {
    // An ambiguous or non-standard codon translates to nothing determinate, not to a
    // guessed residue — 'X' is the honest answer.
    return CODONS[codon.toUpperCase()] ?? "X";
}

export interface Residue {
    /** Amino acid single-letter code, or '*' for stop, 'X' if undeterminable. */
    aa: string;
    /** 1-based inclusive coordinate of the codon's first base. */
    startBp: number;
    /** 1-based inclusive coordinate of the codon's last base. */
    endBp: number;
}

/**
 * Translates a reading frame of `sequence`.
 *
 * `frame` is 0, 1 or 2 — the number of bases skipped before the first codon. Coordinates in
 * the result are 1-based inclusive, matching Feature.start/end.
 */
export function translateFrame(sequence: string, frame: 0 | 1 | 2): Residue[] {
    const residues: Residue[] = [];

    for (let i = frame; i + 3 <= sequence.length; i += 3) {
        residues.push({
            aa: translateCodon(sequence.slice(i, i + 3)),
            startBp: i + 1,
            endBp: i + 3,
        });
    }

    return residues;
}

// The four canonical DNA bases plus U for RNA. Anything else — IUPAC ambiguity codes
// (N, R, Y, H, …) or genuine junk — is "non-standard": the viewer renders it grey and
// GC%/translation ignore it, so we surface it rather than let it pass silently (FR-3).
const STANDARD_BASES = new Set(["A", "C", "G", "T", "U"]);

export interface NonStandardBases {
    /** Total number of non-standard base occurrences in the sequence. */
    total: number;
    /** Distinct offending characters (upper-cased) with counts, most frequent first. */
    characters: { char: string; count: number }[];
}

export function findNonStandardBases(sequence: string): NonStandardBases {
    const counts = new Map<string, number>();
    for (const base of sequence.toUpperCase()) {
        if (!STANDARD_BASES.has(base)) counts.set(base, (counts.get(base) ?? 0) + 1);
    }

    const characters = [...counts.entries()]
        .map(([char, count]) => ({ char, count }))
        .sort((a, b) => b.count - a.count || a.char.localeCompare(b.char));

    return { total: characters.reduce((sum, c) => sum + c.count, 0), characters };
}

/** A one-line summary of `findNonStandardBases`, or null when the sequence is clean. */
export function describeNonStandardBases(result: NonStandardBases): string | null {
    if (result.total === 0) return null;

    const list = result.characters
        .map(c => (c.count > 1 ? `${c.char}×${c.count}` : c.char))
        .join(", ");
    const noun = result.total === 1 ? "base" : "bases";
    return `${result.total} non-standard ${noun} (${list})`;
}

/** GC content as a fraction of A/T/G/C bases; 0 for an empty or non-nucleotide sequence. */
export function gcContent(sequence: string): number {
    let gc = 0;
    let acgt = 0;

    for (const base of sequence.toUpperCase()) {
        if (base === "G" || base === "C") { gc++; acgt++; }
        else if (base === "A" || base === "T") { acgt++; }
    }

    return acgt === 0 ? 0 : gc / acgt;
}
