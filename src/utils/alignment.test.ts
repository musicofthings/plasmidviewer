import { describe, it, expect } from "vitest";
import { alignSequences, calculateOffset, type Mismatch } from "./alignment";
import { parseFasta } from "../parsers/fasta";
import referenceFixture from "../__fixtures__/test.fasta?raw";
import variantFixture from "../__fixtures__/track2-variant.fasta?raw";

describe("alignSequences", () => {
    it("reports no mismatches for identical sequences", () => {
        expect(alignSequences("ACGTACGT", "ACGTACGT")).toEqual([]);
    });

    it("locates a substitution at the correct 1-based reference position", () => {
        // ref   AAACGTAAA
        // query AAATGTAAA
        //          ^ base 4: C -> T
        expect(alignSequences("AAACGTAAA", "AAATGTAAA")).toEqual<Mismatch[]>([
            { type: "sub", pos: 4, refChar: "C", queryChar: "T", length: 1 },
        ]);
    });

    it("locates a deletion and spans the deleted reference bases", () => {
        // ref   AAACCCGGG
        // query AAA---GGG
        expect(alignSequences("AAACCCGGG", "AAAGGG")).toEqual<Mismatch[]>([
            { type: "del", pos: 4, refChar: "CCC", queryChar: "-", length: 3 },
        ]);
    });

    it("locates an insertion and gives it zero reference span", () => {
        // ref   AAA---GGG
        // query AAACCCGGG
        expect(alignSequences("AAAGGG", "AAACCCGGG")).toEqual<Mismatch[]>([
            { type: "ins", pos: 4, refChar: "-", queryChar: "CCC", length: 0 },
        ]);
    });

    it("reports a mismatch at the first base as pos 1, not pos 0", () => {
        const [m] = alignSequences("ACGT", "TCGT");
        expect(m.pos).toBe(1);
        expect(m.type).toBe("sub");
    });

    // Myers is free to choose any minimal edit script, so asserting a particular
    // sub/ins/del breakdown is brittle. What must always hold is that `refChar` is
    // literally the reference text at `pos` — an off-by-one in `pos` breaks this.
    it.each([
        ["AAACGTTTTGGGAAA", "AAAGGTTTTGGG"],
        ["ACGTACGTACGT", "ACGTTTACGTACGT"],
        ["ACGTACGTACGT", "TGCATGCATGCA"],
        ["ACGTACGTACGT", ""],
        ["", "ACGTACGTACGT"],
    ])("reports positions that resolve to the real reference bases (%#)", (reference, query) => {
        for (const m of alignSequences(reference, query)) {
            expect(m.pos).toBeGreaterThanOrEqual(1);
            expect(m.pos).toBeLessThanOrEqual(reference.length + 1);

            if (m.type === "ins") {
                expect(m.length).toBe(0);
                expect(m.refChar).toBe("-");
            } else {
                expect(reference.slice(m.pos - 1, m.pos - 1 + m.length)).toBe(m.refChar);
            }
        }
    });
});

describe("alignSequences against the variant fixture", () => {
    // track2-variant.fasta is test.fasta with three known edits:
    //   sub at base 10 (T->A), deletion of bases 50-54 (5 bp), insertion of GGGG after base 80.
    const reference = parseFasta(referenceFixture).sequence;
    const query = parseFasta(variantFixture).sequence;
    const mismatches = alignSequences(reference, query);

    it("finds the substitution at the exact base", () => {
        expect(mismatches).toContainEqual<Mismatch>({
            type: "sub", pos: 10, refChar: "T", queryChar: "A", length: 1,
        });
    });

    it("finds the insertion at the exact base", () => {
        expect(mismatches).toContainEqual<Mismatch>({
            type: "ins", pos: 81, refChar: "-", queryChar: "GGGG", length: 0,
        });
    });

    it("accounts for all 5 deleted bases", () => {
        // The deletion falls inside a GCTAGCTAG repeat, where several minimal edit
        // scripts are equivalent, so Myers may split it. The total must still be 5 bp.
        const deleted = mismatches.filter(m => m.type === "del");
        expect(deleted.reduce((n, m) => n + m.length, 0)).toBe(5);
        for (const m of deleted) {
            expect(m.pos).toBeGreaterThanOrEqual(50);
            expect(m.pos).toBeLessThanOrEqual(60);
        }
    });

    it("reconciles the length change (-5 deleted, +4 inserted)", () => {
        const deleted = mismatches.filter(m => m.type === "del").reduce((n, m) => n + m.length, 0);
        const inserted = mismatches.filter(m => m.type === "ins").reduce((n, m) => n + m.queryChar.length, 0);
        expect(reference.length - deleted + inserted).toBe(query.length);
    });
});

describe("calculateOffset", () => {
    it("returns 0 for identical sequences", () => {
        expect(calculateOffset("ACGACGACG", "ACGACGACG")).toBe(0);
    });

    it("returns the offset in base pairs when the query is missing a prefix", () => {
        const core = "ACGACGACGACGACG";
        // The query starts 5 bp into the reference, so query coords need +5 to reach ref.
        expect(calculateOffset("TTTTT" + core, core)).toBe(5);
    });

    it("returns a negative offset when the query has an extra prefix", () => {
        const core = "ACGACGACGACGACG";
        expect(calculateOffset(core, "TTTTT" + core)).toBe(-5);
    });
});
