import { describe, it, expect } from "vitest";
import {
    findCutSites, digest, fragments, summariseDigest, filterByCutCount,
    normalisePosition, describeCut, loadEnzymes, suppliersOf,
} from "./enzymes";
import type { Enzyme } from "../models/enzyme";
import type { Plasmid } from "../models/plasmid";

function plasmid(sequence: string, topology: Plasmid["topology"] = "circular"): Plasmid {
    return { name: "p", length: sequence.length, sequence, features: [], topology };
}

const EcoRI: Enzyme = { name: "EcoRI", site: "GAATTC", cutTop: 1, cutBottom: 5, blunt: false };
const SmaI: Enzyme = { name: "SmaI", site: "CCCGGG", cutTop: 3, cutBottom: 3, blunt: true };
const PstI: Enzyme = { name: "PstI", site: "CTGCAG", cutTop: 5, cutBottom: 1, blunt: false };
// Type IIS: cuts 1 nt past the site on the top strand, 5 nt past on the bottom.
const BsaI: Enzyme = { name: "BsaI", site: "GGTCTC", cutTop: 7, cutBottom: 11, blunt: false };

describe("normalisePosition", () => {
    it("wraps positions past either end onto a circle", () => {
        expect(normalisePosition(1, 10)).toBe(1);
        expect(normalisePosition(10, 10)).toBe(10);
        expect(normalisePosition(11, 10)).toBe(1);
        expect(normalisePosition(0, 10)).toBe(10);
        expect(normalisePosition(-1, 10)).toBe(9);
    });
});

describe("findCutSites", () => {
    it("locates a palindromic site and its 5' overhang", () => {
        //          1234567890
        const sites = findCutSites(plasmid("AAGAATTCAA"), EcoRI);
        expect(sites).toHaveLength(1);
        expect(sites[0]).toMatchObject({
            siteStart: 3, siteEnd: 8, topCut: 3, bottomCut: 7, overhang: 4, overhangType: "5'",
        });
    });

    it("reports a palindromic site once, not once per strand", () => {
        expect(findCutSites(plasmid("AAGAATTCAA"), EcoRI)).toHaveLength(1);
    });

    it("calls a blunt cutter blunt", () => {
        const [site] = findCutSites(plasmid("AACCCGGGAA"), SmaI);
        expect(site).toMatchObject({ topCut: 5, bottomCut: 5, overhang: 0, overhangType: "blunt" });
    });

    it("calls a 3' overhang correctly", () => {
        const [site] = findCutSites(plasmid("AACTGCAGAA"), PstI);
        // CTGCA^G at 3..8 -> top cut after 7, bottom after 3.
        expect(site).toMatchObject({ topCut: 7, bottomCut: 3, overhang: -4, overhangType: "3'" });
    });

    it("cuts outside the recognition site for a type IIS enzyme", () => {
        //                      1234567890123456789012
        const sites = findCutSites(plasmid("AAAAGGTCTCAAAAAAAAAAAA"), BsaI);
        expect(sites).toHaveLength(1);
        // Site at 5..10; cutTop 7 -> 4 + 7 = 11, cutBottom 11 -> 4 + 11 = 15.
        expect(sites[0]).toMatchObject({ siteStart: 5, topCut: 11, bottomCut: 15, overhangType: "5'" });
    });

    it("finds a type IIS site on the minus strand and cuts on the other side", () => {
        // Reverse complement of GGTCTC is GAGACC.
        const sites = findCutSites(plasmid("AAAAAAAAAAAAGAGACCAAAA"), BsaI);
        expect(sites).toHaveLength(1);
        const [site] = sites;
        expect(site.strand).toBe("-");
        expect(site.siteStart).toBe(13);
        // anchor = 13 + 6 - 1 = 18; topCut = 18 - 11 = 7, bottomCut = 18 - 7 = 11.
        expect(site.topCut).toBe(7);
        expect(site.bottomCut).toBe(11);
        // A minus-strand site still leaves a 5' overhang.
        expect(site.overhangType).toBe("5'");
    });

    it("finds a site spanning the origin of a circular plasmid", () => {
        // "TTCAA…AAGAA" -> GAATTC straddles the origin.
        const sites = findCutSites(plasmid("TTCAAAAAAAAAAAGAA", "circular"), EcoRI);
        expect(sites).toHaveLength(1);
        expect(sites[0].siteStart).toBe(15);
    });

    it("does not find an origin-spanning site on a linear molecule", () => {
        expect(findCutSites(plasmid("TTCAAAAAAAAAAAGAA", "linear"), EcoRI)).toEqual([]);
    });

    it("drops a type IIS cut that falls off the end of a linear molecule", () => {
        // The site sits at the very end, so BsaI would cut past it.
        expect(findCutSites(plasmid("AAAAGGTCTC", "linear"), BsaI)).toEqual([]);
    });

    it("wraps a type IIS cut around the origin of a circular molecule", () => {
        const sites = findCutSites(plasmid("AAAAGGTCTC", "circular"), BsaI);
        expect(sites).toHaveLength(1);
        // Raw top cut is 11 on a 10 bp circle -> position 1.
        expect(sites[0].topCut).toBe(1);
        expect(sites[0].bottomCut).toBe(5);
    });

    it("matches IUPAC ambiguity in a recognition site", () => {
        // ApoI is RAATTY: both AAATTC and GAATTT are sites.
        const ApoI: Enzyme = { name: "ApoI", site: "RAATTY", cutTop: 1, cutBottom: 5, blunt: false };
        expect(findCutSites(plasmid("AAAATTCAA"), ApoI)).toHaveLength(1);
        expect(findCutSites(plasmid("AAGAATTTA"), ApoI)).toHaveLength(1);
        expect(findCutSites(plasmid("AACAATTCA"), ApoI)).toEqual([]);
    });
});

describe("digest and fragments", () => {
    it("returns one fragment spanning everything when nothing cuts", () => {
        expect(fragments([], 100, "circular"))
            .toEqual([{ start: 1, end: 100, length: 100, wraps: false }]);
    });

    it("gives a circular molecule n fragments for n cuts", () => {
        // 30 bp circle with EcoRI sites at two places.
        const seq = "GAATTC" + "A".repeat(9) + "GAATTC" + "T".repeat(9);
        const p = plasmid(seq, "circular");
        const cuts = digest(p, [EcoRI]);
        expect(cuts).toHaveLength(2);

        const frags = fragments(cuts, p.length, "circular");
        expect(frags).toHaveLength(2);
        // Every base is accounted for exactly once.
        expect(frags.reduce((sum, f) => sum + f.length, 0)).toBe(p.length);
    });

    it("gives a linear molecule n+1 fragments for n cuts", () => {
        const seq = "AAAA" + "GAATTC" + "TTTTTTTT";
        const p = plasmid(seq, "linear");
        const frags = fragments(digest(p, [EcoRI]), p.length, "linear");
        expect(frags).toHaveLength(2);
        expect(frags.reduce((sum, f) => sum + f.length, 0)).toBe(p.length);
    });

    it("marks the fragment that crosses the origin", () => {
        const seq = "A".repeat(10) + "GAATTC" + "T".repeat(10);
        const frags = fragments(digest(plasmid(seq, "circular"), [EcoRI]), seq.length, "circular");
        expect(frags).toHaveLength(1);
        expect(frags[0]).toMatchObject({ wraps: true, length: seq.length });
    });

    it("orders fragments largest first, the way a gel is read", () => {
        const seq = "GAATTC" + "A".repeat(40) + "GAATTC" + "T".repeat(4);
        const frags = fragments(digest(plasmid(seq, "circular"), [EcoRI]), seq.length, "circular");
        expect(frags.map(f => f.length)).toEqual([...frags.map(f => f.length)].sort((a, b) => b - a));
    });
});

describe("summariseDigest / filterByCutCount", () => {
    const seq = "GAATTC" + "A".repeat(10) + "GAATTC" + "A".repeat(4) + "CCCGGG" + "A".repeat(10);
    const p = plasmid(seq, "circular");

    it("counts cuts per enzyme and omits enzymes that never cut", () => {
        const summary = summariseDigest(p, [EcoRI, SmaI, PstI]);
        expect(summary.map(s => [s.enzyme.name, s.cuts])).toEqual([["SmaI", 1], ["EcoRI", 2]]);
    });

    it("finds unique cutters, the ones worth cloning into", () => {
        const unique = filterByCutCount(summariseDigest(p, [EcoRI, SmaI, PstI]), 1, 1);
        expect(unique.map(s => s.enzyme.name)).toEqual(["SmaI"]);
    });
});

describe("describeCut", () => {
    it("writes a 5' overhang the way a catalogue does", () => {
        expect(describeCut(EcoRI)).toBe("G^AATTC / CTTAA^G");
    });

    it("writes a blunt cut", () => {
        // The lower strand is the plain complement written 3'->5', so a palindrome does not
        // repeat itself here — CCCGGG pairs with GGGCCC base for base.
        expect(describeCut(SmaI)).toBe("CCC^GGG / GGG^CCC");
    });

    it("writes a type IIS cut as an offset, since the cut is outside the site", () => {
        expect(describeCut(BsaI)).toBe("GGTCTC(1/5)");
    });
});

describe("the bundled REBASE database", () => {
    it("loads and carries its attribution", async () => {
        const db = await loadEnzymes();
        expect(db.enzymes.length).toBeGreaterThan(500);
        expect(db.source).toContain("REBASE");
        expect(db.copyright).toContain("Roberts");
        expect(db.version).toMatch(/^\d+$/);
    });

    it("agrees with the canonical cut sites of well-known enzymes", async () => {
        const db = await loadEnzymes();
        const by = Object.fromEntries(db.enzymes.map(e => [e.name, e]));

        expect(describeCut(by.EcoRI)).toBe("G^AATTC / CTTAA^G");
        expect(describeCut(by.BamHI)).toBe("G^GATCC / CCTAG^G");
        expect(describeCut(by.HindIII)).toBe("A^AGCTT / TTCGA^A");
        expect(describeCut(by.PstI)).toBe("CTGCA^G / G^ACGTC");
        expect(describeCut(by.NotI)).toBe("GC^GGCCGC / CGCCGG^CG");
        expect(by.SmaI.blunt).toBe(true);
        expect(by.EcoRV.blunt).toBe(true);
    });

    it("resolves supplier codes to company names", async () => {
        const db = await loadEnzymes();
        const by = Object.fromEntries(db.enzymes.map(e => [e.name, e]));
        expect(suppliersOf(by.EcoRI, db)).toContain("New England Biolabs");
    });

    it("keeps only enzymes whose cut position is known", async () => {
        const db = await loadEnzymes();
        // Every entry must have usable numeric cut positions; REBASE's putative enzymes
        // (recognition site predicted, cut position unknown) are excluded at build time.
        expect(db.enzymes.every(e => Number.isFinite(e.cutTop) && Number.isFinite(e.cutBottom))).toBe(true);
        expect(db.enzymes.every(e => e.site.length > 0)).toBe(true);
    });
});
