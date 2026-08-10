import { describe, it, expect } from "vitest";
import {
    optimiseCds, loadCodonTables, cai, gc3, longestHomopolymer, findMotifs, measure,
    relativeAdaptiveness, synonymousCodons, proteinOf, cdsRegions, DEFAULT_CONSTRAINTS,
} from "./codonOptimise";
import type { CodonConstraints, OptimisationStrategy } from "../models/codon";
import type { Plasmid } from "../models/plasmid";

const tables = await loadCodonTables();
const ecoli = tables.hosts.find(h => h.id === "e_coli")!;
const human = tables.hosts.find(h => h.id === "h_sapiens")!;

function constraints(overrides: Partial<CodonConstraints> = {}): CodonConstraints {
    return { ...DEFAULT_CONSTRAINTS, ...overrides };
}

// A CDS built entirely from codons E. coli uses rarely: AGG/AGA (Arg), CTA (Leu), ATA (Ile),
// CCC (Pro), TCC (Ser). This is the situation a codon optimiser exists for.
const RARE_CDS = "ATG" + "AGG AGA CTA ATA CCC AGG CTA ATA AGA CCC".replace(/ /g, "") + "TAA";

describe("the shipped tables", () => {
    it("carries every codon for each of the eleven hosts", () => {
        expect(tables.hosts).toHaveLength(11);
        for (const host of tables.hosts) {
            expect(Object.keys(host.codons)).toHaveLength(64);
            expect(host.cdsCount).toBeGreaterThan(0);
        }
    });

    it("gives each synonymous family a total share of one", () => {
        for (const host of tables.hosts) {
            const families = new Map<string, number>();
            for (const [codon, usage] of Object.entries(host.codons)) {
                const aa = proteinOf(codon);
                families.set(aa, (families.get(aa) ?? 0) + usage.fraction);
            }
            for (const [, sum] of families) expect(sum).toBeCloseTo(1, 2);
        }
    });

    it("matches the published E. coli values", () => {
        // Spot checks against the Kazusa table for E. coli W3110: CTG dominates Leu, and the
        // AGA/AGG arginines are the classic rare pair that stalls heterologous expression.
        expect(ecoli.codons.CTG.fraction).toBeCloseTo(0.50, 2);
        expect(ecoli.codons.AAA.fraction).toBeCloseTo(0.76, 2);
        expect(ecoli.codons.AGA.fraction).toBeLessThan(0.05);
        expect(ecoli.codons.AGG.fraction).toBeLessThan(0.05);
    });
});

describe("synonymousCodons", () => {
    it("groups the genetic code", () => {
        expect(synonymousCodons("M")).toEqual(["ATG"]);
        expect(synonymousCodons("W")).toEqual(["TGG"]);
        expect(synonymousCodons("L")).toHaveLength(6);
        expect(synonymousCodons("R")).toHaveLength(6);
        expect(synonymousCodons("*")).toHaveLength(3);
    });
});

describe("relativeAdaptiveness", () => {
    it("gives the most frequent codon of each family a weight of one", () => {
        const w = relativeAdaptiveness(ecoli);
        expect(w.get("CTG")).toBeCloseTo(1, 5);
        expect(w.get("ATG")).toBeCloseTo(1, 5);
        // A rare synonym is scored against the family's best, not against the genome.
        expect(w.get("CTA")!).toBeLessThan(0.1);
    });
});

describe("cai", () => {
    it("scores a maximally adapted sequence at one", () => {
        // CTG/GAA/AAA are each their family's most used codon in E. coli.
        expect(cai("CTGGAAAAA", ecoli)).toBeCloseTo(1, 5);
    });

    it("scores rare codons well below one", () => {
        expect(cai(RARE_CDS, ecoli)).toBeLessThan(0.25);
    });

    it("ignores codons that carry no synonymous choice", () => {
        // ATG and TGG have single-codon families, so a sequence of them has nothing to score.
        expect(cai("ATGTGG", ecoli)).toBe(0);
    });
});

describe("gc3", () => {
    it("reads only third positions", () => {
        expect(gc3("AAGAAG")).toBe(1);
        expect(gc3("AAAAAA")).toBe(0);
        expect(gc3("AAGAAA")).toBe(0.5);
    });
});

describe("longestHomopolymer", () => {
    it("finds the longest single-base run", () => {
        expect(longestHomopolymer("ACGT")).toBe(1);
        expect(longestHomopolymer("AAACGT")).toBe(3);
        expect(longestHomopolymer("ACGTTTTTT")).toBe(6);
        expect(longestHomopolymer("")).toBe(0);
    });
});

describe("findMotifs", () => {
    it("finds a motif on the forward strand", () => {
        expect(findMotifs("AAGAATTCAA", ["GAATTC"])).toEqual([{ motif: "GAATTC", offset: 2 }]);
    });

    it("finds a non-palindromic motif on the reverse strand", () => {
        // GGTCTC (BsaI) reverse-complements to GAGACC.
        expect(findMotifs("AAGAGACCAA", ["GGTCTC"])).toEqual([{ motif: "GGTCTC", offset: 2 }]);
    });

    it("reports a palindromic motif once", () => {
        expect(findMotifs("AAGAATTCAA", ["GAATTC"])).toHaveLength(1);
    });

    it("honours IUPAC ambiguity", () => {
        // GGWCC matches GGACC and GGTCC.
        expect(findMotifs("GGACCGGTCC", ["GGWCC"])).toHaveLength(2);
    });
});

const STRATEGIES: OptimisationStrategy[] = ["highest", "matched", "rare-only"];

describe("optimiseCds — the invariant", () => {
    for (const strategy of STRATEGIES) {
        it(`preserves the protein exactly under "${strategy}"`, () => {
            for (const host of tables.hosts) {
                const result = optimiseCds(RARE_CDS, host, { strategy, constraints: constraints() });
                expect(proteinOf(result.sequence)).toBe(proteinOf(RARE_CDS));
                expect(result.sequence).toHaveLength(RARE_CDS.length);
            }
        });
    }

    it("preserves the protein on a longer, more varied sequence", () => {
        // Every amino acid at least once, so no family goes untested.
        const cds = "ATG" + "GCTTGCGATGAATTTGGCCATATTAAACTGATGAATCCGCAGCGTAGCACCGTTTGGTAT"
            + "GCGTGTGACGAGTTCGGACACATCAAGCTAATGAACCCACAAAGGTCTACAGTCTGGTAC" + "TAA";
        for (const strategy of STRATEGIES) {
            const result = optimiseCds(cds, ecoli, { strategy, constraints: constraints() });
            expect(proteinOf(result.sequence)).toBe(proteinOf(cds));
        }
    });

    it("is deterministic", () => {
        const once = optimiseCds(RARE_CDS, ecoli, { strategy: "matched", constraints: constraints() });
        const twice = optimiseCds(RARE_CDS, ecoli, { strategy: "matched", constraints: constraints() });
        expect(once.sequence).toBe(twice.sequence);
    });

    it("carries trailing bases that cannot form a codon through untouched", () => {
        const result = optimiseCds(RARE_CDS + "AT", ecoli, {
            strategy: "highest", constraints: constraints(),
        });
        expect(result.sequence).toHaveLength(RARE_CDS.length + 2);
        expect(result.sequence.endsWith("AT")).toBe(true);
    });

    it("passes an unreadable codon through rather than guessing at it", () => {
        const result = optimiseCds("ATGNNNCTA", ecoli, {
            strategy: "highest", constraints: constraints(),
        });
        expect(result.sequence.slice(3, 6)).toBe("NNN");
        expect(result.untouched).toBe(1);
    });
});

describe("optimiseCds — strategies", () => {
    it("'highest' picks the host's most frequent synonym", () => {
        // Leu and Arg both have six codons; in E. coli the winners are CTG and CGC.
        const result = optimiseCds("CTAAGG", ecoli, {
            strategy: "highest",
            // Constraints off, so this measures the strategy and nothing else.
            constraints: constraints({ localWindow: 0, maxHomopolymer: 0, maxRepeat: 0, gcMin: 0, gcMax: 1 }),
        });
        expect(result.sequence).toBe("CTGCGC");
    });

    it("'highest' raises CAI toward one", () => {
        const result = optimiseCds(RARE_CDS, ecoli, {
            strategy: "highest",
            constraints: constraints({ localWindow: 0, maxHomopolymer: 0, maxRepeat: 0, gcMin: 0, gcMax: 1 }),
        });
        expect(result.before.cai).toBeLessThan(0.25);
        expect(result.after.cai).toBeCloseTo(1, 5);
    });

    it("'rare-only' leaves codons the host already likes alone", () => {
        // A sequence of E. coli's favourite codons has nothing rare in it to fix.
        const common = "ATGCTGAAAGAAGCGCAGACCTAA";
        const result = optimiseCds(common, ecoli, {
            strategy: "rare-only", constraints: constraints(),
        });
        expect(result.changes).toHaveLength(0);
        expect(result.sequence).toBe(common);
    });

    it("'rare-only' still replaces the rare ones", () => {
        const result = optimiseCds(RARE_CDS, ecoli, {
            strategy: "rare-only",
            constraints: constraints({ localWindow: 0, maxHomopolymer: 0, maxRepeat: 0, gcMin: 0, gcMax: 1 }),
        });
        expect(result.changes.length).toBeGreaterThan(0);
        expect(result.after.cai).toBeGreaterThan(result.before.cai);
    });

    it("'matched' spreads codons across the family instead of collapsing to one", () => {
        // Twenty leucines: 'highest' makes twenty CTGs, 'matched' should not.
        const cds = "CTA".repeat(20);
        const relaxed = constraints({ localWindow: 0, maxHomopolymer: 0, maxRepeat: 0, gcMin: 0, gcMax: 1 });

        const highest = optimiseCds(cds, ecoli, { strategy: "highest", constraints: relaxed });
        const matched = optimiseCds(cds, ecoli, { strategy: "matched", constraints: relaxed });

        const distinct = (s: string) =>
            new Set(s.match(/.{3}/g) ?? []).size;
        expect(distinct(highest.sequence)).toBe(1);
        expect(distinct(matched.sequence)).toBeGreaterThan(1);

        // And the mix should track the host: CTG is half of E. coli's leucines, so about half
        // of twenty codons should be CTG.
        const ctg = (matched.sequence.match(/CTG/g) ?? []).length;
        expect(ctg).toBeGreaterThanOrEqual(8);
        expect(ctg).toBeLessThanOrEqual(12);
    });
});

describe("optimiseCds — constraints", () => {
    it("keeps a forbidden restriction site out of the result", () => {
        // GAATTC (EcoRI) spelled in-frame: GAA TTC is Glu-Phe, and both have a synonym, so the
        // site is avoidable without touching the protein.
        const cds = "ATGGAATTCAAA";
        const result = optimiseCds(cds, ecoli, {
            strategy: "highest",
            constraints: constraints({ avoidSites: ["GAATTC"] }),
        });

        expect(findMotifs(result.sequence, ["GAATTC"])).toHaveLength(0);
        expect(proteinOf(result.sequence)).toBe(proteinOf(cds));
        expect(result.before.avoidedSiteHits).toBe(1);
        expect(result.after.avoidedSiteHits).toBe(0);
    });

    it("avoids a site on the reverse strand too", () => {
        // Encodes ...GAGACC..., the reverse complement of BsaI's GGTCTC.
        const cds = "ATGGAGACCAAA";
        const result = optimiseCds(cds, ecoli, {
            strategy: "highest",
            constraints: constraints({ avoidSites: ["GGTCTC"] }),
        });
        expect(findMotifs(result.sequence, ["GGTCTC"])).toHaveLength(0);
    });

    it("sees a site that only exists because of the flanking construct", () => {
        // The CDS starts with TTC; the G and AA before it come from the vector, so GAATTC only
        // exists across the junction. An optimiser that ignores its flanks would miss this.
        const result = optimiseCds("TTCAAAGGT", ecoli, {
            strategy: "highest",
            constraints: constraints({ avoidSites: ["GAATTC"] }),
            upstream: "CCCGAA",
        });
        expect(result.sequence.startsWith("TTC")).toBe(false);
        expect(findMotifs("CCCGAA" + result.sequence, ["GAATTC"])).toHaveLength(0);
    });

    it("respects the homopolymer cap", () => {
        // Lysine runs: AAA AAA AAA is a 9-A homopolymer, and AAG is the only alternative.
        const result = optimiseCds("AAAAAAAAAAAA", ecoli, {
            strategy: "highest",
            constraints: constraints({ maxHomopolymer: 4, localWindow: 0, gcMin: 0, gcMax: 1 }),
        });
        expect(longestHomopolymer(result.sequence)).toBeLessThanOrEqual(4);
        expect(proteinOf(result.sequence)).toBe("KKKK");
    });

    it("pulls global GC back into the requested band", () => {
        // Optimising for E. coli's favourites alone lands this well above 65% GC.
        const cds = "ATG" + "GCGGCGGCGCCGCCGCCGGGCGGCGGCCTGCTGCTG".repeat(3) + "TAA";
        const result = optimiseCds(cds, ecoli, {
            strategy: "highest",
            constraints: constraints({ gcMin: 0.40, gcMax: 0.60, localWindow: 0 }),
        });

        expect(result.after.gc).toBeGreaterThanOrEqual(0.40);
        expect(result.after.gc).toBeLessThanOrEqual(0.60);
        expect(proteinOf(result.sequence)).toBe(proteinOf(cds));
        expect(result.remaining.filter(v => v.kind === "global-gc")).toHaveLength(0);
    });

    it("reports a constraint it could not satisfy rather than pretending", () => {
        // Six prolines with a 1-base homopolymer cap: every proline codon begins CC, so a run
        // of two is unavoidable no matter which synonyms are picked. The optimiser must say so
        // rather than quietly returning a sequence that breaks the rule it was given.
        const result = optimiseCds("CCGCCGCCGCCGCCGCCG", ecoli, {
            strategy: "highest",
            constraints: constraints({ maxHomopolymer: 1, localWindow: 0, gcMin: 0, gcMax: 1 }),
        });
        expect(proteinOf(result.sequence)).toBe("PPPPPP");
        expect(result.remaining.some(v => v.kind === "homopolymer")).toBe(true);
    });
});

describe("cdsRegions", () => {
    function withFeature(
        sequence: string, start: number, end: number, strand: "+" | "-",
        topology: Plasmid["topology"] = "circular",
    ): Plasmid {
        return {
            name: "p", length: sequence.length, sequence, topology,
            features: [{ id: "f1", name: "gene", type: "CDS", start, end, strand }],
        };
    }

    it("reads a plus-strand CDS with its flanks", () => {
        //                    1234567890123456789012
        const p = withFeature("AAAACCCATGAAATAAGGGTTT", 8, 16, "+");
        const [region] = cdsRegions(p, 4);

        expect(region.sequence).toBe("ATGAAATAA");
        expect(region.upstream).toBe("ACCC");
        expect(region.downstream).toBe("GGGT");
        expect(region.partial).toBe(false);
    });

    it("reverse-complements a minus-strand CDS and swaps its flanks", () => {
        // TTATTTCAT is ATGAAATAA read on the other strand.
        const p = withFeature("AAAACCCTTATTTCATGGGTTT", 8, 16, "-");
        const [region] = cdsRegions(p, 4);

        expect(region.sequence).toBe("ATGAAATAA");
        // The bases 5' of a minus-strand gene sit *after* it on the forward sequence.
        expect(region.upstream).toBe("ACCC");
        expect(region.downstream).toBe("GGGT");
    });

    it("follows a CDS across the origin of a circular construct", () => {
        // The gene starts at base 20 and wraps: ATG | AAATAA.
        const p = withFeature("AAATAACCCCCCCCCCCCCATG", 20, 6, "+");
        const [region] = cdsRegions(p, 3);

        expect(region.sequence).toBe("ATGAAATAA");
        expect(region.upstream).toBe("CCC");
        expect(region.downstream).toBe("CCC");
    });

    it("flags a CDS whose length is not a whole number of codons", () => {
        expect(cdsRegions(withFeature("AAAATGAAAT", 5, 10, "+"))[0].partial).toBe(false);
        expect(cdsRegions(withFeature("AAAATGAAATA", 5, 11, "+"))[0].partial).toBe(true);
    });

    it("does not run off the end of a linear construct", () => {
        const p = withFeature("ATGAAATAAGG", 1, 9, "+", "linear");
        const [region] = cdsRegions(p, 10);

        expect(region.sequence).toBe("ATGAAATAA");
        expect(region.upstream).toBe("");
        expect(region.downstream).toBe("GG");
    });

    it("ignores features that are not CDSs", () => {
        const p = withFeature("ATGAAATAAGG", 1, 9, "+");
        p.features.push({ id: "f2", name: "prom", type: "promoter", start: 1, end: 5, strand: "+" });
        expect(cdsRegions(p)).toHaveLength(1);
    });
});

describe("measure", () => {
    it("summarises a sequence against a host", () => {
        const metrics = measure("ATGGAATTCAAA", ecoli, ["GAATTC"]);
        expect(metrics.avoidedSiteHits).toBe(1);
        // ATG GAA TTC AAA — three of the twelve bases are G or C.
        expect(metrics.gc).toBeCloseTo(3 / 12, 5);
        expect(metrics.longestHomopolymer).toBe(3);
    });
});

describe("host differences", () => {
    it("optimises the same protein differently for E. coli and human", () => {
        // Arg is the textbook case: E. coli wants CGC/CGT, human leans on AGG/AGA/CGG.
        const cds = "ATGCGTCGTCGTCGTCGTTAA";
        const relaxed = constraints({ localWindow: 0, maxHomopolymer: 0, maxRepeat: 0, gcMin: 0, gcMax: 1 });

        const forEcoli = optimiseCds(cds, ecoli, { strategy: "highest", constraints: relaxed });
        const forHuman = optimiseCds(cds, human, { strategy: "highest", constraints: relaxed });

        expect(forEcoli.sequence).not.toBe(forHuman.sequence);
        expect(proteinOf(forEcoli.sequence)).toBe(proteinOf(forHuman.sequence));
    });

    it("scores a human gene higher against human than against E. coli", () => {
        const humanish = "ATG" + "CTGCTGCAGCTGCTGGAGCTGCTGCAGCTGCTGGAG" + "TGA";
        expect(cai(humanish, human)).toBeGreaterThan(cai(humanish, ecoli));
    });
});

describe("a real-world shape", () => {
    // GFP's first 30 codons, as they appear in the jellyfish gene — a classic case for
    // optimisation, since Aequorea codon usage suits neither E. coli nor human cells.
    const GFP = "ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGT"
        + "GATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGA";

    it("raises CAI for E. coli while holding the protein", () => {
        const result = optimiseCds(GFP, ecoli, {
            strategy: "highest", constraints: constraints(),
        });
        expect(proteinOf(result.sequence)).toBe(proteinOf(GFP));
        expect(result.after.cai).toBeGreaterThan(result.before.cai);
        expect(result.changes.length).toBeGreaterThan(10);
    });

    it("meets every default constraint it is given", () => {
        for (const host of [ecoli, human]) {
            const result = optimiseCds(GFP, host, {
                strategy: "matched",
                constraints: constraints({ avoidSites: ["GAATTC", "GGATCC", "AAGCTT"] }),
            });
            expect(proteinOf(result.sequence)).toBe(proteinOf(GFP));
            expect(result.remaining).toHaveLength(0);
        }
    });
});
