import { describe, it, expect } from "vitest";
import { simulatePcr, ampliconPlasmid, describeAmplicon } from "./pcr";
import { reverseComplement } from "./sequence";
import type { Plasmid, Feature } from "../models/plasmid";
import type { Primer } from "../models/primer";

// A template with two unique 20-mers separated by a known middle, so every product below can be
// written out by hand rather than trusted.
const F = "GCTAGCATCGATCGATTGCA";      // forward primer anneals here, template 5..24
const MID = "TTTTTGGGGGAAAAACCCCC";    // template 25..44
const R_TOP = "AGGCATCAGTCAGTACGTCA";  // reverse primer anneals to the bottom strand, 45..64
const TEMPLATE = "AAAA" + F + MID + R_TOP + "TTTT"; // 68 bp

function plasmid(
    topology: Plasmid["topology"] = "linear", features: Feature[] = [],
): Plasmid {
    return { name: "pTest", length: TEMPLATE.length, sequence: TEMPLATE, topology, features };
}

const fwd: Primer = { id: "f", name: "Fwd", sequence: F };
const rev: Primer = { id: "r", name: "Rev", sequence: reverseComplement(R_TOP) };

describe("simulatePcr — the basic product", () => {
    it("amplifies between a facing pair", () => {
        const products = simulatePcr(plasmid(), [fwd, rev]);

        expect(products).toHaveLength(1);
        expect(products[0].sequence).toBe(F + MID + R_TOP);
        expect(products[0].length).toBe(60);
        // Which is exactly the template from the forward primer's 5' base to the reverse
        // primer's, since neither primer carries a tail here.
        expect(products[0].sequence).toBe(TEMPLATE.slice(4, 64));
    });

    it("reports the template span it covers", () => {
        const [product] = simulatePcr(plasmid(), [fwd, rev]);
        expect(product.templateStart).toBe(5);
        expect(product.templateEnd).toBe(64);
        expect(product.wraps).toBe(false);
    });

    it("suggests an annealing temperature below the weaker primer", () => {
        const [product] = simulatePcr(plasmid(), [fwd, rev]);
        const weaker = Math.min(product.forward.tm, product.reverse.tm);
        expect(product.annealingTemp).toBeCloseTo(weaker - 5, 5);
    });

    it("gives no product when the primers point away from each other", () => {
        // Swapping the roles points both primers outward.
        const outwardF: Primer = { id: "f2", name: "F2", sequence: R_TOP };
        const outwardR: Primer = { id: "r2", name: "R2", sequence: reverseComplement(F) };
        expect(simulatePcr(plasmid("linear"), [outwardF, outwardR])).toHaveLength(0);
    });

    it("gives no product when the annealing regions overlap", () => {
        // A reverse primer annealing over the forward primer's own site is a dimer, not an
        // amplicon — there is no template between them to copy.
        const overlapping: Primer = { id: "r3", name: "R3", sequence: reverseComplement(F) };
        expect(simulatePcr(plasmid("linear"), [fwd, overlapping])).toHaveLength(0);
    });
});

describe("simulatePcr — primers are incorporated, not just matched", () => {
    it("carries a 5' tail into the product even though the template lacks it", () => {
        const tailed: Primer = { id: "ft", name: "Fwd-EcoRI", sequence: "GAATTC" + F };
        const [product] = simulatePcr(plasmid(), [tailed, rev]);

        expect(product.sequence.startsWith("GAATTC")).toBe(true);
        expect(product.length).toBe(66);
        expect(product.forward.tailLength).toBe(6);
        // The tail exists nowhere on the template — that is the point of adding it.
        expect(TEMPLATE.includes("GAATTC")).toBe(false);
    });

    it("carries a reverse primer's tail onto the far end, reverse-complemented", () => {
        // BsaI plus its spacer, deliberately *not* palindromic — with a palindromic site like
        // BamHI's GGATCC this assertion could not fail and would prove nothing.
        const TAIL = "GGTCTCA";
        const tailed: Primer = {
            id: "rt", name: "Rev-BsaI", sequence: TAIL + reverseComplement(R_TOP),
        };
        const [product] = simulatePcr(plasmid(), [fwd, tailed]);

        // A 5' tail on the reverse primer appears at the 3' end of the top strand, reversed and
        // complemented — TGAGACC, not GGTCTCA.
        expect(product.sequence.endsWith(reverseComplement(TAIL))).toBe(true);
        expect(product.sequence.endsWith(TAIL)).toBe(false);
        expect(product.length).toBe(67);

        // The whole oligo is incorporated however it splits into anneal and tail. Asserting the
        // split itself would be wrong here: this tail's 3'-most base happens to complement the
        // template base just past the annealing region, so it genuinely pairs and the walk
        // counts it as annealed. A "tail" is only the part that does not pair, not the part the
        // designer thinks of as the tail.
        expect(product.reverse.annealLength + product.reverse.tailLength)
            .toBe(tailed.sequence.length);
    });

    it("writes a mismatched base the primer's way, not the template's", () => {
        // Site-directed mutagenesis: one substitution well 5' of the 3' anchor.
        const mutant = "GCTC" + F.slice(4);
        expect(mutant).not.toBe(F);

        const mutagenic: Primer = { id: "fm", name: "Fwd-mut", sequence: mutant };
        const [product] = simulatePcr(plasmid(), [mutagenic, rev], {
            binding: { maxMismatches: 1 },
        });

        expect(product.sequence.startsWith(mutant)).toBe(true);
        expect(product.sequence.startsWith(F)).toBe(false);
        expect(product.forward.mismatches).toBe(1);
    });
});

describe("simulatePcr — circular templates", () => {
    it("amplifies across the origin when the primers point outward", () => {
        // On a circle, "pointing away" simply means the product goes the other way round —
        // this is inverse / around-the-horn PCR, the basis of whole-plasmid mutagenesis.
        const outwardF: Primer = { id: "f2", name: "F2", sequence: R_TOP };
        const outwardR: Primer = { id: "r2", name: "R2", sequence: reverseComplement(F) };

        const products = simulatePcr(plasmid("circular"), [outwardF, outwardR]);
        expect(products).toHaveLength(1);

        const [product] = products;
        expect(product.wraps).toBe(true);
        expect(product.templateStart).toBe(45);
        expect(product.templateEnd).toBe(24);
        // 20 nt primer + TTTT + AAAA across the origin + 20 nt primer.
        expect(product.sequence).toBe(R_TOP + "TTTT" + "AAAA" + F);
        expect(product.length).toBe(48);
    });

    it("still finds the ordinary inward product on a circle", () => {
        const products = simulatePcr(plasmid("circular"), [fwd, rev]);
        expect(products.some(p => p.sequence === F + MID + R_TOP)).toBe(true);
    });
});

describe("simulatePcr — specificity and limits", () => {
    it("reports every product when a primer anneals more than once", () => {
        // A template carrying the reverse site twice gives two bands off one pair.
        const doubled = TEMPLATE + "GGGGG" + R_TOP;
        const p: Plasmid = {
            name: "p", length: doubled.length, sequence: doubled, topology: "linear", features: [],
        };

        const products = simulatePcr(p, [fwd, rev]);
        expect(products).toHaveLength(2);
        expect(products[0].length).toBeLessThan(products[1].length);
    });

    it("drops products longer than the polymerase limit", () => {
        expect(simulatePcr(plasmid(), [fwd, rev], { maxProductBp: 50 })).toHaveLength(0);
        expect(simulatePcr(plasmid(), [fwd, rev], { maxProductBp: 60 })).toHaveLength(1);
    });

    it("returns nothing without primers or template", () => {
        expect(simulatePcr(plasmid(), [])).toEqual([]);
        expect(simulatePcr(
            { name: "e", length: 0, sequence: "", topology: "linear", features: [] }, [fwd, rev],
        )).toEqual([]);
    });
});

describe("simulatePcr — feature transfer", () => {
    const contained: Feature = {
        id: "c", name: "insert", type: "CDS", start: 25, end: 34, strand: "+",
    };
    const straddling: Feature = {
        id: "s", name: "half-marker", type: "marker", start: 60, end: 68, strand: "+",
    };

    it("rebases a wholly contained feature onto the product", () => {
        const [product] = simulatePcr(plasmid("linear", [contained]), [fwd, rev]);

        expect(product.features).toHaveLength(1);
        // Template 25 is 20 bases past the product's first template base (5), and there is no
        // tail, so it lands at 21.
        expect(product.features[0]).toMatchObject({ name: "insert", start: 21, end: 30 });
    });

    it("shifts transferred features by the forward primer's tail", () => {
        const tailed: Primer = { id: "ft", name: "F-tail", sequence: "GAATTC" + F };
        const [product] = simulatePcr(plasmid("linear", [contained]), [tailed, rev]);
        expect(product.features[0]).toMatchObject({ start: 27, end: 36 });
    });

    it("drops a partly-covered feature but names it", () => {
        const [product] = simulatePcr(plasmid("linear", [straddling]), [fwd, rev]);

        expect(product.features).toHaveLength(0);
        expect(product.truncated).toEqual(["half-marker"]);
    });

    it("does not transfer a feature whose body runs the other way round the circle", () => {
        // Both endpoints fall inside the product, but the feature itself wraps the origin the
        // long way — it is not contained despite looking like it is.
        const wrapping: Feature = {
            id: "w", name: "wraps-away", type: "misc", start: 60, end: 10, strand: "+",
        };
        const [product] = simulatePcr(plasmid("circular", [wrapping]), [fwd, rev]);

        expect(product.features.some(f => f.name === "wraps-away")).toBe(false);
        expect(product.truncated).toContain("wraps-away");
    });
});

describe("ampliconPlasmid", () => {
    it("builds a linear construct with both primers annotated", () => {
        const [product] = simulatePcr(plasmid(), [fwd, rev]);
        const built = ampliconPlasmid(product, "pTest");

        expect(built.topology).toBe("linear");
        expect(built.length).toBe(60);
        expect(built.sequence).toBe(product.sequence);

        const binds = built.features.filter(f => f.rawType === "primer_bind");
        expect(binds).toHaveLength(2);
        expect(binds[0]).toMatchObject({ name: "Fwd", start: 1, end: 20, strand: "+" });
        expect(binds[1]).toMatchObject({ name: "Rev", start: 41, end: 60, strand: "-" });
    });

    it("places the primer annotations over the tails too", () => {
        const tailed: Primer = { id: "ft", name: "F-tail", sequence: "GAATTC" + F };
        const [product] = simulatePcr(plasmid(), [tailed, rev]);
        const built = ampliconPlasmid(product, "pTest");

        // The whole oligo is the primer_bind, tail included — 26 nt starting at base 1.
        const forwardBind = built.features.find(f => f.strand === "+" && f.rawType === "primer_bind");
        expect(forwardBind).toMatchObject({ start: 1, end: 26 });
        expect(forwardBind?.description).toContain("5' tail");
    });

    it("carries transferred features alongside the primer annotations", () => {
        const contained: Feature = {
            id: "c", name: "insert", type: "CDS", start: 25, end: 34, strand: "+",
        };
        const [product] = simulatePcr(plasmid("linear", [contained]), [fwd, rev]);
        const built = ampliconPlasmid(product, "pTest");

        expect(built.features.map(f => f.name)).toEqual(["insert", "Fwd", "Rev"]);
    });
});

describe("describeAmplicon", () => {
    it("reads as a length and a span", () => {
        const [product] = simulatePcr(plasmid(), [fwd, rev]);
        expect(describeAmplicon(product)).toBe("60 bp · 5–64");
    });

    it("marks a product that crosses the origin", () => {
        const outwardF: Primer = { id: "f2", name: "F2", sequence: R_TOP };
        const outwardR: Primer = { id: "r2", name: "R2", sequence: reverseComplement(F) };
        const [product] = simulatePcr(plasmid("circular"), [outwardF, outwardR]);
        expect(describeAmplicon(product)).toContain("origin");
    });
});
