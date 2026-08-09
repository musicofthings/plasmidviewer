import { describe, it, expect } from "vitest";
import {
    meltingTemp, findBindingSites, findAllBindingSites, primersFromFeatures,
    primerGcPercent, hasGcClamp, describeBindingSite,
} from "./primers";
import { reverseComplement } from "./sequence";
import type { Primer } from "../models/primer";
import type { Feature, Plasmid } from "../models/plasmid";

function plasmid(
    sequence: string,
    topology: Plasmid["topology"] = "linear",
    features: Feature[] = [],
): Plasmid {
    return { name: "p", length: sequence.length, sequence, features, topology };
}

function primer(sequence: string, name = "p1"): Primer {
    return { id: name, name, sequence };
}

//                       1234567890123456789012345678901234567890
const TEMPLATE = "GGCTTAACCGTTAGGCATCAGTTGACCTAGCAATTCGGTA";
//                       12345678901234567890
const CIRCLE = "ACGTTGCATTGCACCTAGGA";

describe("meltingTemp", () => {
    it("matches the nearest-neighbour calculation done by hand", () => {
        // ATGC: steps AT(-7.2/-20.4) + TG(-8.5/-22.7) + GC(-9.8/-24.4) = -25.5 / -67.5.
        // Ends A and C add (2.3/4.1) and (0.1/-2.8) -> -23.1 / -66.2.
        // Salt: -66.2 + 0.368*3*ln(0.05) = -69.507.
        // Tm = -23100 / (-69.507 + 1.987*ln(6.25e-8)) - 273.15.
        expect(meltingTemp("ATGC")).toBeCloseTo(-47.71, 1);
    });

    it("puts a real primer where the catalogue puts it", () => {
        // M13 forward (-20), quoted around 52 °C at standard PCR conditions.
        expect(meltingTemp("GTAAAACGACGGCCAGT")).toBeCloseTo(51.7, 0);
    });

    it("is higher for a GC-rich oligo than an AT-rich one of the same length", () => {
        expect(meltingTemp("GCGCGCGCGCGCGCGC")).toBeGreaterThan(meltingTemp("ATATATATATATATAT"));
    });

    it("rises with salt", () => {
        const low = meltingTemp("GTAAAACGACGGCCAGT", { primerMolar: 0.25e-6, sodiumMolar: 0.01 });
        const high = meltingTemp("GTAAAACGACGGCCAGT", { primerMolar: 0.25e-6, sodiumMolar: 0.2 });
        expect(high).toBeGreaterThan(low);
    });

    it("falls as the primer is diluted", () => {
        const concentrated = meltingTemp("GTAAAACGACGGCCAGT", { primerMolar: 1e-6, sodiumMolar: 0.05 });
        const dilute = meltingTemp("GTAAAACGACGGCCAGT", { primerMolar: 0.05e-6, sodiumMolar: 0.05 });
        expect(concentrated).toBeGreaterThan(dilute);
    });

    it("applies the symmetry penalty and CT (not CT/4) to a self-complementary oligo", () => {
        // GAATTC is its own reverse complement: ΔH -39.2, ΔS -114.8, then -1.4 for symmetry
        // and -5.512 for salt. Tm = -39200 / (-121.712 + 1.987*ln(2.5e-7)) - 273.15.
        expect(meltingTemp("GAATTC")).toBeCloseTo(-15.12, 1);
    });

    it("returns NaN rather than guessing at an ambiguity code", () => {
        expect(meltingTemp("ACGTNACGT")).toBeNaN();
        expect(meltingTemp("ACGRACGT")).toBeNaN();
    });

    it("returns NaN below one nearest-neighbour step", () => {
        expect(meltingTemp("")).toBeNaN();
        expect(meltingTemp("A")).toBeNaN();
    });
});

describe("findBindingSites", () => {
    it("finds a perfectly matched forward primer", () => {
        const forward = TEMPLATE.slice(10, 26); // 11..26, 16 nt
        const sites = findBindingSites(plasmid(TEMPLATE), primer(forward));

        expect(sites).toHaveLength(1);
        expect(sites[0]).toMatchObject({
            start: 11, end: 26, strand: "+", threePrime: 26,
            annealLength: 16, tailLength: 0, mismatches: 0, wraps: false,
        });
    });

    it("finds a reverse primer over the same region, anchored at the other end", () => {
        const reverse = reverseComplement(TEMPLATE.slice(10, 26));
        const sites = findBindingSites(plasmid(TEMPLATE), primer(reverse));

        expect(sites).toHaveLength(1);
        // A reverse primer extends toward lower coordinates, so its 3' base is at `start`.
        expect(sites[0]).toMatchObject({
            start: 11, end: 26, strand: "-", threePrime: 11, annealLength: 16, tailLength: 0,
        });
    });

    it("ignores a 5' cloning tail and reports only what anneals", () => {
        const withTail = "GCGCGAATTC" + TEMPLATE.slice(10, 26);
        const [site] = findBindingSites(plasmid(TEMPLATE), primer(withTail));

        expect(site).toMatchObject({
            start: 11, end: 26, strand: "+", annealLength: 16, tailLength: 10,
        });
    });

    it("quotes the Tm of the annealing region, not of the whole oligo", () => {
        const anneals = TEMPLATE.slice(10, 26);
        const [site] = findBindingSites(plasmid(TEMPLATE), primer("GCGCGAATTC" + anneals));

        expect(site.tm).toBeCloseTo(meltingTemp(anneals), 6);
        expect(site.tm).toBeLessThan(meltingTemp("GCGCGAATTC" + anneals));
    });

    it("refuses a primer mismatched at its 3' end", () => {
        const anneals = TEMPLATE.slice(10, 26);
        const dead = anneals.slice(0, -1) + (anneals.endsWith("A") ? "G" : "A");

        expect(findBindingSites(plasmid(TEMPLATE), primer(dead))).toEqual([]);
    });

    it("stops the anneal at an interior mismatch, or reads through it when told to", () => {
        const anneals = TEMPLATE.slice(10, 26);
        // Break the 3rd base from the 5' end — well clear of the 3' anchor.
        const mutated = anneals.slice(0, 2) + (anneals[2] === "A" ? "C" : "A") + anneals.slice(3);

        // Intolerant: the anneal simply ends at the mismatch and the rest becomes tail.
        const [strict] = findBindingSites(plasmid(TEMPLATE), primer(mutated));
        expect(strict).toMatchObject({
            start: 14, end: 26, annealLength: 13, tailLength: 3, mismatches: 0,
        });

        // Tolerant: the same primer is recognised as a mutagenic one binding its full length.
        const [loose] = findBindingSites(plasmid(TEMPLATE), primer(mutated), { maxMismatches: 1 });
        expect(loose).toMatchObject({
            start: 11, end: 26, annealLength: 16, tailLength: 0, mismatches: 1,
        });
    });

    it("does not report an anneal shorter than the threshold", () => {
        const short = TEMPLATE.slice(15, 26); // 11 nt, one under the default
        expect(findBindingSites(plasmid(TEMPLATE), primer(short))).toEqual([]);
        expect(findBindingSites(plasmid(TEMPLATE), primer(short), { minAnneal: 11 })).toHaveLength(1);
    });

    it("finds a forward primer that anneals across the origin of a circle", () => {
        const spanning = CIRCLE.slice(10) + CIRCLE.slice(0, 4); // 11..20 then 1..4, 14 nt
        const [site] = findBindingSites(plasmid(CIRCLE, "circular"), primer(spanning));

        expect(site).toMatchObject({
            start: 11, end: 4, strand: "+", threePrime: 4, annealLength: 14, wraps: true,
        });
    });

    it("finds a reverse primer across the origin too", () => {
        const spanning = reverseComplement(CIRCLE.slice(10) + CIRCLE.slice(0, 4));
        const [site] = findBindingSites(plasmid(CIRCLE, "circular"), primer(spanning));

        expect(site).toMatchObject({
            start: 11, end: 4, strand: "-", threePrime: 11, wraps: true,
        });
    });

    it("does not invent an origin-spanning site on a linear sequence", () => {
        const spanning = CIRCLE.slice(10) + CIRCLE.slice(0, 4);
        expect(findBindingSites(plasmid(CIRCLE, "linear"), primer(spanning))).toEqual([]);
    });

    it("reports one site per 3' position, not one per possible anneal length", () => {
        // A homopolymer would report every truncation if the walk kept its intermediates.
        const sites = findBindingSites(plasmid("A".repeat(20), "circular"), primer("A".repeat(14)));
        expect(sites).toHaveLength(20);
        expect(sites.every(s => s.annealLength === 14)).toBe(true);
    });

    it("matches IUPAC ambiguity in a degenerate primer", () => {
        const degenerate = "NN" + TEMPLATE.slice(12, 26);
        const [site] = findBindingSites(plasmid(TEMPLATE), primer(degenerate));
        expect(site).toMatchObject({ start: 11, end: 26, annealLength: 16, tailLength: 0 });
    });

    it("returns nothing for an empty primer", () => {
        expect(findBindingSites(plasmid(TEMPLATE), primer(""))).toEqual([]);
    });
});

describe("findAllBindingSites", () => {
    it("merges several primers into one list ordered along the sequence", () => {
        const late = primer(TEMPLATE.slice(20, 36), "late");
        const early = primer(TEMPLATE.slice(2, 18), "early");

        const sites = findAllBindingSites(plasmid(TEMPLATE), [late, early]);
        expect(sites.map(s => s.primerId)).toEqual(["early", "late"]);
        expect(sites[0].start).toBeLessThan(sites[1].start);
    });
});

describe("primersFromFeatures", () => {
    const features: Feature[] = [
        {
            id: "f1", name: "M13 fwd", type: "misc", rawType: "primer_bind",
            start: 11, end: 26, strand: "+",
        },
        {
            id: "f2", name: "M13 rev", type: "misc", rawType: "primer_bind",
            start: 25, end: 40, strand: "-",
        },
        { id: "f3", name: "AmpR", type: "CDS", rawType: "CDS", start: 1, end: 9, strand: "+" },
    ];

    it("recovers the oligo a primer_bind annotation stands for", () => {
        const primers = primersFromFeatures(plasmid(TEMPLATE, "circular", features));

        expect(primers).toHaveLength(2);
        expect(primers[0]).toMatchObject({
            name: "M13 fwd", sequence: TEMPLATE.slice(10, 26), fromFeatureId: "f1",
        });
    });

    it("reads a minus-strand annotation as the oligo, not as the template", () => {
        const [, reverse] = primersFromFeatures(plasmid(TEMPLATE, "circular", features));
        expect(reverse.sequence).toBe(reverseComplement(TEMPLATE.slice(24, 40)));
    });

    it("round-trips: a recovered primer binds where its annotation said it did", () => {
        const construct = plasmid(TEMPLATE, "circular", features);
        const [forward, reverse] = primersFromFeatures(construct);

        expect(findBindingSites(construct, forward)[0]).toMatchObject({ start: 11, end: 26, strand: "+" });
        expect(findBindingSites(construct, reverse)[0]).toMatchObject({ start: 25, end: 40, strand: "-" });
    });

    it("leaves everything that is not a primer alone", () => {
        const primers = primersFromFeatures(plasmid(TEMPLATE, "circular", features));
        expect(primers.map(p => p.name)).not.toContain("AmpR");
    });
});

describe("primer statistics", () => {
    it("reports GC as a percentage of the whole oligo", () => {
        expect(primerGcPercent("GGCC")).toBe(100);
        expect(primerGcPercent("ATGC")).toBe(50);
        expect(primerGcPercent("AAAA")).toBe(0);
        expect(primerGcPercent("")).toBe(0);
    });

    it("calls a GC clamp only between one and three G/C in the last five bases", () => {
        expect(hasGcClamp("AAAAAAAAAAAAAAAAAAAG")).toBe(true);  // AAAAG — one
        expect(hasGcClamp("AAAAAAAAAAAAAAAAGCG")).toBe(true);   // AAGCG — three
        expect(hasGcClamp("AAAAAAAAAAAAAAAAAAAA")).toBe(false); // AAAAA — none, it frays
        expect(hasGcClamp("AAAAAAAAAAAAAAAGCGC")).toBe(false);  // AGCGC — four, it misprimes
    });
});

describe("describeBindingSite", () => {
    it("spells out the tail and the mismatches when there are any", () => {
        const withTail = "GCGCGAATTC" + TEMPLATE.slice(10, 26);
        const [site] = findBindingSites(plasmid(TEMPLATE), primer(withTail));
        expect(describeBindingSite(site)).toBe("→ 11..26 · 10 nt tail");
    });

    it("says so when a site crosses the origin", () => {
        const spanning = CIRCLE.slice(10) + CIRCLE.slice(0, 4);
        const [site] = findBindingSites(plasmid(CIRCLE, "circular"), primer(spanning));
        expect(describeBindingSite(site)).toBe("→ 11..4 (wraps origin)");
    });
});
