import { describe, it, expect } from "vitest";
import { parseGenBank } from "./genbank";
import { parseFasta } from "./fasta";
import { featureFromTeselagen, type TeselagenFeature } from "./teselagen";
import genbankFixture from "../__fixtures__/test.gb?raw";
import fastaFixture from "../__fixtures__/test.fasta?raw";

function fixtureFile(text: string, name: string): File {
    return new File([text], name);
}

describe("parseGenBank", () => {
    // Ground truth is the fixture's own FEATURES table, which GenBank specifies as
    // 1-based inclusive: CDS 1..30, promoter 40..50, terminator 80..90.
    it("preserves the GenBank location numbers verbatim", async () => {
        const plasmid = await parseGenBank(fixtureFile(genbankFixture, "test.gb"));

        expect(plasmid.length).toBe(120);
        expect(plasmid.sequence).toHaveLength(120);
        expect(plasmid.features).toHaveLength(3);

        expect(plasmid.features.map(f => ({
            name: f.name,
            type: f.type,
            start: f.start,
            end: f.end,
            strand: f.strand,
        }))).toEqual([
            { name: "TestGene1", type: "CDS", start: 1, end: 30, strand: "+" },
            { name: "Prom1", type: "promoter", start: 40, end: 50, strand: "+" },
            { name: "Term1", type: "terminator", start: 80, end: 90, strand: "+" },
        ]);
    });

    it("yields feature lengths of end - start + 1", async () => {
        const plasmid = await parseGenBank(fixtureFile(genbankFixture, "test.gb"));
        expect(plasmid.features.map(f => f.end - f.start + 1)).toEqual([30, 11, 11]);
    });

    it("reads topology from the LOCUS line (FR-5)", async () => {
        // test.gb's LOCUS line declares "circular".
        const plasmid = await parseGenBank(fixtureFile(genbankFixture, "test.gb"));
        expect(plasmid.topology).toBe("circular");
    });
});

describe("featureFromTeselagen", () => {
    // Both parsers convert through this one function, so GenBank and SnapGene cannot
    // disagree on coordinates for the same underlying record (FR-2).
    it("converts 0-based inclusive Teselagen ranges to 1-based inclusive", () => {
        const teselagenCds: TeselagenFeature = {
            id: "f1", name: "TestGene1", type: "CDS", start: 0, end: 29, strand: 1,
        };
        expect(featureFromTeselagen(teselagenCds)).toEqual({
            id: "f1", name: "TestGene1", type: "CDS", start: 1, end: 30, strand: "+",
        });
    });

    it("maps reverse-strand features to '-'", () => {
        const f = featureFromTeselagen({ start: 9, end: 19, type: "CDS", strand: -1 });
        expect(f.strand).toBe("-");
        expect(f.start).toBe(10);
        expect(f.end).toBe(20);
    });

    it("normalizes unknown feature types to 'misc'", () => {
        expect(featureFromTeselagen({ start: 0, end: 1, type: "misc_feature" }).type).toBe("misc");
        expect(featureFromTeselagen({ start: 0, end: 1, type: "rep_origin" }).type).toBe("misc");
        expect(featureFromTeselagen({ start: 0, end: 1, type: "AmpR_promoter" }).type).toBe("promoter");
    });
});

describe("parseFasta", () => {
    it("reads the header and sequence", () => {
        const plasmid = parseFasta(fastaFixture);
        expect(plasmid.name).toBe("TestPlasmid");
        expect(plasmid.length).toBe(plasmid.sequence.length);
        expect(plasmid.sequence).toMatch(/^[ACGT]+$/);
        expect(plasmid.features).toEqual([]);
        // FASTA carries no topology, so it defaults to linear (FR-5).
        expect(plasmid.topology).toBe("linear");
    });

    it("uppercases and strips non-letter characters", () => {
        const plasmid = parseFasta(">x\nacgt 123\nac-gt\n");
        expect(plasmid.sequence).toBe("ACGTACGT");
        expect(plasmid.length).toBe(8);
    });
});
