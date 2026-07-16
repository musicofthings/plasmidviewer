import { describe, it, expect } from "vitest";
import {
    complement, reverseComplement, translateCodon, translateFrame, gcContent,
    findNonStandardBases, describeNonStandardBases,
} from "./sequence";

describe("complement / reverseComplement", () => {
    it("complements each base in place", () => {
        expect(complement("ATGC")).toBe("TACG");
    });

    it("reverse-complements", () => {
        expect(reverseComplement("ATGC")).toBe("GCAT");
    });

    it("is its own inverse", () => {
        const seq = "ATGCGTGCGTTAGCGCGTTAGCG";
        expect(reverseComplement(reverseComplement(seq))).toBe(seq);
    });

    it("preserves IUPAC ambiguity codes rather than dropping them", () => {
        expect(complement("RYSWKM")).toBe("YRSWMK");
        expect(complement("N")).toBe("N");
    });

    it("maps an unknown character to N", () => {
        expect(complement("H!")).toBe("DN");
    });
});

describe("translateCodon", () => {
    it("translates start and stop codons", () => {
        expect(translateCodon("ATG")).toBe("M");
        expect(translateCodon("TAA")).toBe("*");
        expect(translateCodon("TAG")).toBe("*");
        expect(translateCodon("TGA")).toBe("*");
    });

    it("is case-insensitive", () => {
        expect(translateCodon("atg")).toBe("M");
    });

    it("returns X for an ambiguous codon instead of guessing", () => {
        expect(translateCodon("ATN")).toBe("X");
        expect(translateCodon("??")).toBe("X");
    });
});

describe("translateFrame", () => {
    it("translates frame 0 with 1-based inclusive codon coordinates", () => {
        // ATG AAA TAA  ->  M K *
        expect(translateFrame("ATGAAATAA", 0)).toEqual([
            { aa: "M", startBp: 1, endBp: 3 },
            { aa: "K", startBp: 4, endBp: 6 },
            { aa: "*", startBp: 7, endBp: 9 },
        ]);
    });

    it("offsets the reading frame", () => {
        // frame 1 on GATGAAATAA -> ATG AAA TAA
        const residues = translateFrame("GATGAAATAA", 1);
        expect(residues.map(r => r.aa).join("")).toBe("MK*");
        expect(residues[0].startBp).toBe(2);
        expect(residues[0].endBp).toBe(4);
    });

    it("drops a trailing partial codon", () => {
        // 8 bases in frame 0 = 2 whole codons + 2 leftover bases
        expect(translateFrame("ATGAAATA", 0)).toHaveLength(2);
    });

    it("returns nothing when the frame leaves less than one codon", () => {
        expect(translateFrame("AT", 0)).toEqual([]);
        expect(translateFrame("ATGA", 2)).toEqual([]);
    });
});

describe("gcContent", () => {
    it("computes the GC fraction", () => {
        expect(gcContent("GGCC")).toBe(1);
        expect(gcContent("ATAT")).toBe(0);
        expect(gcContent("ATGC")).toBe(0.5);
    });

    it("ignores non-ACGT characters rather than counting them as AT", () => {
        // 'N' must not dilute the denominator: GC/(A+T+G+C) = 2/2 = 1
        expect(gcContent("GCNN")).toBe(1);
    });

    it("returns 0 for an empty sequence", () => {
        expect(gcContent("")).toBe(0);
    });
});

describe("findNonStandardBases", () => {
    it("finds nothing in a clean ACGT sequence", () => {
        expect(findNonStandardBases("ACGTACGT")).toEqual({ total: 0, characters: [] });
    });

    it("does not warn on U (RNA is standard)", () => {
        expect(findNonStandardBases("ACGUACGU").total).toBe(0);
    });

    it("flags IUPAC ambiguity codes and junk, case-insensitively", () => {
        // The stray 'h' in test.gb's sequence is exactly this case.
        const result = findNonStandardBases("ACGThACGTn");
        expect(result.total).toBe(2);
        expect(result.characters).toEqual([
            { char: "H", count: 1 },
            { char: "N", count: 1 },
        ]);
    });

    it("counts repeats and orders by frequency, then alphabetically", () => {
        const result = findNonStandardBases("NNNRRH");
        expect(result.characters).toEqual([
            { char: "N", count: 3 },
            { char: "R", count: 2 },
            { char: "H", count: 1 },
        ]);
    });
});

describe("describeNonStandardBases", () => {
    it("is null for a clean sequence", () => {
        expect(describeNonStandardBases(findNonStandardBases("ACGT"))).toBeNull();
    });

    it("names a single offending base without a count", () => {
        expect(describeNonStandardBases(findNonStandardBases("ACGTh"))).toBe("1 non-standard base (H)");
    });

    it("shows counts only when a base repeats", () => {
        expect(describeNonStandardBases(findNonStandardBases("NNNRRH")))
            .toBe("6 non-standard bases (N×3, R×2, H)");
    });
});
