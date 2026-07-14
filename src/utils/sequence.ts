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
