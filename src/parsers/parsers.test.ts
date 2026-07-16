import { describe, it, expect } from "vitest";
import { parseGenBank } from "./genbank";
import { parseFasta } from "./fasta";
import { featureFromTeselagen, describeFeature, type TeselagenFeature } from "./teselagen";
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

    it("folds primer_bind annotations (Teselagen's separate primers array) into features", async () => {
        const gb = [
            "LOCUS       pP 60 bp DNA circular SYN 01-FEB-2026",
            "FEATURES             Location/Qualifiers",
            "     CDS             1..30",
            '                     /label="G1"',
            "     primer_bind     40..55",
            '                     /label="M13 fwd"',
            "ORIGIN",
            "        1 atgcgtgcgt tagcgcgtta gcggcgcgcg cgcgcgcgta gctagctagc tagctagatg",
            "//",
        ].join("\n");
        const plasmid = await parseGenBank(fixtureFile(gb, "pP.gb"));
        const primer = plasmid.features.find(f => f.name === "M13 fwd");
        expect(primer).toBeDefined();
        expect(primer?.rawType).toBe("primer_bind");
    });
});

describe("featureFromTeselagen", () => {
    // Both parsers convert through this one function, so GenBank and SnapGene cannot
    // disagree on coordinates for the same underlying record (FR-2).
    it("converts 0-based inclusive Teselagen ranges to 1-based inclusive", () => {
        const teselagenCds: TeselagenFeature = {
            id: "f1", name: "TestGene1", type: "CDS", start: 0, end: 29, strand: 1,
            notes: { note: ["A test gene"] },
        };
        expect(featureFromTeselagen(teselagenCds)).toEqual({
            id: "f1", name: "TestGene1", type: "CDS", start: 1, end: 30, strand: "+",
            rawType: "CDS", description: "A test gene",
        });
    });

    it("maps reverse-strand features to '-'", () => {
        const f = featureFromTeselagen({ start: 9, end: 19, type: "CDS", strand: -1 });
        expect(f.strand).toBe("-");
        expect(f.start).toBe(10);
        expect(f.end).toBe(20);
    });

    it("normalizes unknown feature types to 'misc' but keeps the raw type", () => {
        expect(featureFromTeselagen({ start: 0, end: 1, type: "misc_feature" }).type).toBe("misc");
        const origin = featureFromTeselagen({ start: 0, end: 1, type: "rep_origin" });
        expect(origin.type).toBe("misc");
        expect(origin.rawType).toBe("rep_origin");
        expect(featureFromTeselagen({ start: 0, end: 1, type: "AmpR_promoter" }).type).toBe("promoter");
        expect(featureFromTeselagen({ start: 0, end: 1, type: "enhancer" }).type).toBe("promoter");
    });
});

describe("describeFeature", () => {
    it("prefers /note, then /product, /function, /gene", () => {
        expect(describeFeature({ note: ["confers ampicillin resistance"] })).toBe("confers ampicillin resistance");
        expect(describeFeature({ product: ["beta-lactamase"], gene: ["bla"] })).toBe("beta-lactamase");
        expect(describeFeature({ gene: ["bla"] })).toBe("bla");
    });

    it("joins multiple values and returns undefined when empty", () => {
        expect(describeFeature({ note: ["a", "b"] })).toBe("a; b");
        expect(describeFeature({})).toBeUndefined();
        expect(describeFeature(undefined)).toBeUndefined();
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
