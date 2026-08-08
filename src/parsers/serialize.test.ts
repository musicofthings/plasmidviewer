import { describe, it, expect } from "vitest";
import { genbankToJson } from "@teselagen/bio-parsers";
import { toFasta, toGenBank, featureLocation, originBlock } from "./serialize";
import { plasmidFromTeselagen, type TeselagenSequence } from "./teselagen";
import { parseFasta } from "./fasta";
import type { Plasmid } from "../models/plasmid";
import genbankFixture from "../__fixtures__/test.gb?raw";

const FIXED_DATE = new Date(2026, 7, 8);

function plasmid(overrides: Partial<Plasmid> = {}): Plasmid {
    return {
        name: "pTest",
        length: 48,
        sequence: "ATGCGTACGTTAGCACCGGTTACGATCGATCGGCTAGCTAGGCATCGA",
        features: [],
        topology: "circular",
        ...overrides,
    };
}

describe("toFasta", () => {
    it("writes a header and wraps the sequence at 60 columns", () => {
        const text = toFasta(plasmid({ sequence: "A".repeat(130), length: 130 }));
        const lines = text.trimEnd().split("\n");
        expect(lines[0]).toBe(">pTest");
        expect(lines.slice(1).map(l => l.length)).toEqual([60, 60, 10]);
    });

    it("round-trips through parseFasta", () => {
        const original = plasmid();
        const reparsed = parseFasta(toFasta(original));
        expect(reparsed.name).toBe(original.name);
        expect(reparsed.sequence).toBe(original.sequence);
        expect(reparsed.length).toBe(original.length);
    });
});

describe("featureLocation", () => {
    it("passes 1-based inclusive coordinates straight through", () => {
        expect(featureLocation({ start: 1, end: 30, strand: "+" })).toBe("1..30");
    });

    it("wraps a reverse-strand feature in complement()", () => {
        expect(featureLocation({ start: 5, end: 20, strand: "-" })).toBe("complement(5..20)");
    });
});

describe("originBlock", () => {
    it("lays out 60 bases per line as six space-separated groups of ten", () => {
        const [first] = originBlock("ACGT".repeat(20));
        expect(first).toBe("        1 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt");
    });

    it("numbers each line by its first base", () => {
        const lines = originBlock("A".repeat(130));
        expect(lines.map(l => l.slice(0, 9).trim())).toEqual(["1", "61", "121"]);
    });
});

describe("toGenBank", () => {
    const annotated = plasmid({
        features: [
            { id: "f1", name: "GeneA", type: "CDS", start: 1, end: 30, strand: "+", rawType: "CDS" },
            {
                id: "f2", name: "ori1", type: "misc", start: 35, end: 44, strand: "-",
                rawType: "rep_origin", description: "origin of replication",
            },
        ],
    });

    it("declares length and topology on the LOCUS line", () => {
        const text = toGenBank(annotated, { date: FIXED_DATE });
        expect(text.split("\n")[0]).toContain("48 bp");
        expect(text.split("\n")[0]).toContain("circular");
        expect(text.split("\n")[0]).toContain("08-AUG-2026");
    });

    it("writes linear topology for a linear construct", () => {
        expect(toGenBank(plasmid({ topology: "linear" }), { date: FIXED_DATE }).split("\n")[0])
            .toContain("linear");
    });

    it("ends with the GenBank record terminator", () => {
        expect(toGenBank(annotated, { date: FIXED_DATE }).trimEnd().endsWith("//")).toBe(true);
    });

    // The real test of a writer is whether a parser that did not write it agrees.
    it("round-trips features through @teselagen/bio-parsers with identical coordinates", async () => {
        const text = toGenBank(annotated, { date: FIXED_DATE });
        const parsed = await genbankToJson(text);
        const reparsed = plasmidFromTeselagen(parsed[0].parsedSequence as TeselagenSequence, "x");

        expect(reparsed.sequence).toBe(annotated.sequence);
        expect(reparsed.length).toBe(annotated.length);
        expect(reparsed.topology).toBe("circular");
        expect(reparsed.features.map(f => ({
            name: f.name, start: f.start, end: f.end, strand: f.strand, rawType: f.rawType,
        }))).toEqual([
            { name: "GeneA", start: 1, end: 30, strand: "+", rawType: "CDS" },
            { name: "ori1", start: 35, end: 44, strand: "-", rawType: "rep_origin" },
        ]);
    });

    it("preserves the verbatim source type rather than our collapsed bucket", async () => {
        const text = toGenBank(annotated, { date: FIXED_DATE });
        // rep_origin collapses to "misc" for glyph shape; writing "misc" would lose it.
        expect(text).toContain("rep_origin");
        const parsed = await genbankToJson(text);
        const reparsed = plasmidFromTeselagen(parsed[0].parsedSequence as TeselagenSequence, "x");
        expect(reparsed.features[1].rawType).toBe("rep_origin");
    });

    it("carries the /note qualifier across a round trip", async () => {
        const parsed = await genbankToJson(toGenBank(annotated, { date: FIXED_DATE }));
        const reparsed = plasmidFromTeselagen(parsed[0].parsedSequence as TeselagenSequence, "x");
        expect(reparsed.features[1].description).toBe("origin of replication");
    });

    it("survives a full import -> export -> import cycle of a real GenBank file", async () => {
        const imported = plasmidFromTeselagen(
            (await genbankToJson(genbankFixture))[0].parsedSequence as TeselagenSequence, "test.gb",
        );
        const roundTripped = plasmidFromTeselagen(
            (await genbankToJson(toGenBank(imported, { date: FIXED_DATE })))[0]
                .parsedSequence as TeselagenSequence, "x",
        );

        expect(roundTripped.sequence).toBe(imported.sequence);
        expect(roundTripped.topology).toBe(imported.topology);
        expect(roundTripped.features.map(f => [f.name, f.start, f.end, f.strand]))
            .toEqual(imported.features.map(f => [f.name, f.start, f.end, f.strand]));
    });

    it("escapes embedded quotes so they cannot terminate a qualifier early", async () => {
        const quoted = plasmid({
            features: [{ id: "q", name: 'weird "quoted" name', type: "misc", start: 1, end: 5, strand: "+" }],
        });
        const parsed = await genbankToJson(toGenBank(quoted, { date: FIXED_DATE }));
        const reparsed = plasmidFromTeselagen(parsed[0].parsedSequence as TeselagenSequence, "x");
        expect(reparsed.features).toHaveLength(1);
        expect(reparsed.features[0].start).toBe(1);
        expect(reparsed.features[0].end).toBe(5);
    });

    it("replaces whitespace in the locus name, which GenBank forbids", () => {
        expect(toGenBank(plasmid({ name: "my plasmid v2" }), { date: FIXED_DATE }).split("\n")[0])
            .toContain("my_plasmid_v2");
    });
});
