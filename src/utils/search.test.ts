import { describe, it, expect } from "vitest";
import {
    iupacMask, matchesAt, findDnaMatches, findProteinMatches, findFeatureMatches,
    detectSearchKind, searchPlasmid,
} from "./search";
import { reverseComplement } from "./sequence";
import type { Feature, Plasmid } from "../models/plasmid";

function plasmid(sequence: string, topology: Plasmid["topology"] = "linear", features: Feature[] = []): Plasmid {
    return { name: "p", length: sequence.length, sequence, features, topology };
}

describe("iupacMask / matchesAt", () => {
    it("matches concrete bases", () => {
        expect(matchesAt("ACGT", "CG", 1)).toBe(true);
        expect(matchesAt("ACGT", "CA", 1)).toBe(false);
    });

    it("treats N in the query as any base", () => {
        expect(matchesAt("ACGT", "ANGT", 0)).toBe(true);
    });

    it("treats N in the subject as any base, so a concrete query still finds it", () => {
        expect(matchesAt("ANGT", "ACGT", 0)).toBe(true);
    });

    it("intersects degenerate codes on both sides", () => {
        // R = A|G, Y = C|T — they share nothing.
        expect(matchesAt("R", "Y", 0)).toBe(false);
        // R = A|G and A intersect.
        expect(matchesAt("R", "A", 0)).toBe(true);
        // U in the query matches T in the subject.
        expect(matchesAt("ACGT", "ACGU", 0)).toBe(true);
    });

    it("never matches junk characters rather than treating them as wildcards", () => {
        expect(iupacMask("Z")).toBe(0);
        expect(matchesAt("ACGT", "AZGT", 0)).toBe(false);
    });
});

describe("findDnaMatches", () => {
    it("finds a forward match with 1-based inclusive coordinates", () => {
        const hits = findDnaMatches(plasmid("AAGGTTCCAA"), "GGTT");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ start: 3, end: 6, strand: "+", wraps: false });
    });

    it("finds a match on the reverse strand", () => {
        // "AACC" reverse-complements to "GGTT", which occurs at 3..6.
        const hits = findDnaMatches(plasmid("AAGGTTCCAA"), "AACC");
        expect(hits.map(h => [h.start, h.end, h.strand])).toEqual([[3, 6, "-"]]);
    });

    it("reports a palindrome once, not once per strand", () => {
        // GAATTC (EcoRI) is its own reverse complement.
        expect(reverseComplement("GAATTC")).toBe("GAATTC");
        const hits = findDnaMatches(plasmid("AAGAATTCAA"), "GAATTC");
        expect(hits).toHaveLength(1);
    });

    it("finds overlapping occurrences", () => {
        expect(findDnaMatches(plasmid("AAAAA"), "AAA").map(h => h.start)).toEqual([1, 2, 3]);
    });

    it("finds a site spanning the origin of a circular construct", () => {
        // ...ends with "GG", begins with "TT" -> GGTT crosses the origin at 9..2.
        const hits = findDnaMatches(plasmid("TTAAAAAAGG", "circular"), "GGTT");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ start: 9, end: 2, wraps: true, strand: "+" });
    });

    it("does not wrap a linear construct", () => {
        expect(findDnaMatches(plasmid("TTAAAAAAGG", "linear"), "GGTT")).toEqual([]);
    });

    it("does not report the same circular site twice", () => {
        // A query that occurs once near the start must not reappear via the wrap extension.
        expect(findDnaMatches(plasmid("GGTTAAAAAA", "circular"), "GGTT")).toHaveLength(1);
    });

    it("finds degenerate queries", () => {
        // GGNTT matches GGATT and GGCTT.
        const hits = findDnaMatches(plasmid("GGATTAAGGCTT"), "GGNTT");
        expect(hits.map(h => h.start)).toEqual([1, 8]);
    });

    it("returns nothing for an empty query or one longer than the sequence", () => {
        expect(findDnaMatches(plasmid("ACGT"), "")).toEqual([]);
        expect(findDnaMatches(plasmid("ACGT"), "ACGTA")).toEqual([]);
    });
});

describe("findProteinMatches", () => {
    // ATG AAA TTT -> M K F, starting at base 1 (frame 1, forward).
    const coding = "ATGAAATTT";

    it("finds a peptide in a forward frame with exact nucleotide bounds", () => {
        const hits = findProteinMatches(plasmid(coding), "MKF");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ start: 1, end: 9, strand: "+", frame: 1 });
    });

    it("reports the frame it found the peptide in", () => {
        // One leading base pushes the same ORF into frame 2.
        const hits = findProteinMatches(plasmid("C" + coding), "MKF");
        expect(hits[0]).toMatchObject({ start: 2, end: 10, frame: 2, strand: "+" });
    });

    it("finds a peptide encoded on the reverse strand and maps it to forward coordinates", () => {
        const seq = reverseComplement(coding);
        const hits = findProteinMatches(plasmid(seq), "MKF");
        expect(hits).toHaveLength(1);
        // The whole 9 bp sequence encodes it, read on the minus strand.
        expect(hits[0]).toMatchObject({ start: 1, end: 9, strand: "-", frame: 1 });
    });

    it("locates a reverse-strand peptide offset from the start", () => {
        const seq = "GGGG" + reverseComplement(coding) + "CC";
        const hits = findProteinMatches(plasmid(seq), "MKF").filter(h => h.strand === "-");
        expect(hits).toHaveLength(1);
        // 4 leading bases -> the coding stretch occupies 5..13 in forward coordinates.
        expect(hits[0]).toMatchObject({ start: 5, end: 13 });
        // And that slice really does reverse-translate to the peptide.
        expect(reverseComplement(seq.slice(4, 13))).toBe(coding);
    });

    it("matches a stop codon as *", () => {
        expect(findProteinMatches(plasmid("ATGTAA"), "M*")).toHaveLength(1);
    });

    it("returns nothing for an empty query", () => {
        expect(findProteinMatches(plasmid(coding), "")).toEqual([]);
    });
});

describe("findFeatureMatches", () => {
    const features: Feature[] = [
        { id: "1", name: "AmpR", type: "marker", start: 10, end: 50, strand: "+", rawType: "CDS" },
        { id: "2", name: "lacZ", type: "CDS", start: 60, end: 90, strand: "-", description: "beta-galactosidase" },
        { id: "3", name: "ori", type: "misc", start: 5, end: 8, strand: "+", rawType: "rep_origin" },
    ];

    it("matches on name, case-insensitively", () => {
        expect(findFeatureMatches(features, "ampr").map(h => h.match)).toEqual(["AmpR"]);
    });

    it("matches on the verbatim type", () => {
        expect(findFeatureMatches(features, "rep_origin").map(h => h.match)).toEqual(["ori"]);
    });

    it("matches on the description", () => {
        expect(findFeatureMatches(features, "galactosidase").map(h => h.match)).toEqual(["lacZ"]);
    });

    it("returns hits ordered by position", () => {
        expect(findFeatureMatches(features, "").map(h => h.match)).toEqual([]);
        expect(findFeatureMatches(features, "a").map(h => h.start)).toEqual([10, 60]);
    });

    it("carries the feature through so the caller can select it", () => {
        expect(findFeatureMatches(features, "ori")[0].feature?.id).toBe("3");
    });
});

describe("detectSearchKind", () => {
    it("treats nucleotide-only input as DNA", () => {
        expect(detectSearchKind("acgt")).toBe("dna");
        expect(detectSearchKind("GGNTTRY")).toBe("dna");
    });

    it("treats anything with non-nucleotide letters as protein", () => {
        expect(detectSearchKind("MKFLE")).toBe("protein");
    });
});

describe("searchPlasmid", () => {
    it("dispatches on kind", () => {
        const p = plasmid("ATGAAATTT", "linear", [
            { id: "1", name: "gene", type: "CDS", start: 1, end: 9, strand: "+" },
        ]);
        expect(searchPlasmid(p, "ATG", "dna")).toHaveLength(1);
        expect(searchPlasmid(p, "MKF", "protein")).toHaveLength(1);
        expect(searchPlasmid(p, "gene", "feature")).toHaveLength(1);
    });
});
