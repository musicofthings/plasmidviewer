import { describe, it, expect } from "vitest";
import {
    resolvingRange, migrate, layoutLane, layoutGel, laneFromLengths, resolutionAt, LADDERS,
} from "./gel";
import type { GelConditions, Lane } from "../models/gel";

const at = (agarosePercent: number): GelConditions => ({ agarosePercent });

describe("resolvingRange", () => {
    it("returns the tabulated window for a listed concentration", () => {
        expect(resolvingRange(1.0)).toEqual({ min: 500, max: 10000 });
        expect(resolvingRange(2.0)).toEqual({ min: 50, max: 2000 });
    });

    it("clamps outside the table rather than extrapolating", () => {
        expect(resolvingRange(0.1)).toEqual(resolvingRange(0.5));
        expect(resolvingRange(9)).toEqual(resolvingRange(3.0));
    });

    it("interpolates between rows, in log space", () => {
        const mid = resolvingRange(1.75);
        const lower = resolvingRange(1.5);
        const upper = resolvingRange(2.0);

        expect(mid.min).toBeGreaterThan(upper.min);
        expect(mid.min).toBeLessThan(lower.min);
        // Log interpolation puts the halfway point at the geometric mean, not the arithmetic one.
        expect(mid.max).toBeCloseTo(Math.sqrt(lower.max * upper.max), -1);
    });

    it("gives a higher percentage a lower window — that is what more agarose is for", () => {
        expect(resolvingRange(2.0).max).toBeLessThan(resolvingRange(0.5).max);
        expect(resolvingRange(2.0).min).toBeLessThan(resolvingRange(0.5).min);
    });
});

describe("migrate", () => {
    const range = { min: 500, max: 10000 };

    it("runs a small fragment further than a large one", () => {
        expect(migrate(1000, range).y).toBeGreaterThan(migrate(8000, range).y);
    });

    it("is linear in the logarithm of size", () => {
        // Equal ratios travel equal distances: 8000→4000 should move as far as 4000→2000.
        const a = migrate(8000, range).y;
        const b = migrate(4000, range).y;
        const c = migrate(2000, range).y;
        expect(b - a).toBeCloseTo(c - b, 6);
    });

    it("marks anything outside the window as carrying no size information", () => {
        expect(migrate(50000, range)).toMatchObject({ resolved: false });
        expect(migrate(100, range)).toMatchObject({ resolved: false });
        expect(migrate(3000, range)).toMatchObject({ resolved: true });
    });

    it("piles the too-large at the top and the too-small at the front", () => {
        expect(migrate(50000, range).y).toBeLessThan(migrate(9000, range).y);
        expect(migrate(100, range).y).toBeGreaterThan(migrate(600, range).y);
        // Two fragments both past the limit land together — the gel cannot tell them apart.
        expect(migrate(50000, range).y).toBe(migrate(999999, range).y);
    });

    it("keeps every band inside the gel", () => {
        for (const bp of [1, 100, 3000, 10000, 1e6]) {
            const { y } = migrate(bp, range);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(1);
        }
    });
});

describe("layoutLane", () => {
    it("orders bands down the gel by decreasing size", () => {
        const lane = laneFromLengths("l", "digest", "digest", [3000, 900, 1500]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands.map(b => b.sizes[0])).toEqual([3000, 1500, 900]);
        expect(bands[0].y).toBeLessThan(bands[1].y);
        expect(bands[1].y).toBeLessThan(bands[2].y);
    });

    it("merges bands that would co-migrate", () => {
        // 2,017 and 2,027 bp do not separate on a 1% gel, and drawing them apart would invite
        // reading a doublet that is not there.
        const lane = laneFromLengths("l", "d", "digest", [2027, 2017]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands).toHaveLength(1);
        expect(bands[0].sizes).toEqual([2027, 2017]);
        expect(bands[0].label).toBe("2.0 kb + 2.0 kb");
    });

    it("labels a pile-up with a bound, not a list of everything in it", () => {
        // A 1 kb ladder on a 2% gel puts everything from 2 kb up in one place. Listing all seven
        // sizes there would be text longer than the gel is wide, and would claim a precision the
        // position does not have.
        const { bands } = layoutLane(LADDERS[0], at(2.0));
        const pile = bands[0];

        expect(pile.sizes.length).toBeGreaterThan(2);
        expect(pile.label).toBe("> 2.0 kb");
        // The sizes are still there for a tooltip to show.
        expect(pile.sizes).toContain(10000);
    });

    it("bounds a pile-up at the dye front from below", () => {
        const lane = laneFromLengths("l", "d", "digest", [200, 150, 90]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands).toHaveLength(1);
        expect(bands[0].label).toBe("< 500");
    });

    it("summarises three or more co-migrating resolved bands by count", () => {
        const lane = laneFromLengths("l", "d", "digest", [2000, 2005, 2010]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands).toHaveLength(1);
        expect(bands[0].label).toBe("3 bands");
    });

    it("keeps clearly separated bands apart", () => {
        const lane = laneFromLengths("l", "d", "digest", [3000, 1000]);
        expect(layoutLane(lane, at(1.0)).bands).toHaveLength(2);
    });

    it("brightens by mass, not by copy number", () => {
        // Equimolar fragments: the 5 kb carries ten times the DNA of the 500 bp, and looks it.
        const lane = laneFromLengths("l", "d", "digest", [5000, 500]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands[0].intensity).toBeGreaterThan(bands[1].intensity);
    });

    it("flags a band too faint to see", () => {
        // A 100 bp fragment beside a 20 kb one is under 1% of the mass — the classic
        // "where did my small band go" case.
        const lane = laneFromLengths("l", "d", "digest", [20000, 100]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands.find(b => b.sizes[0] === 20000)?.faint).toBe(false);
        expect(bands.find(b => b.sizes[0] === 100)?.faint).toBe(true);
    });

    it("does not call a ladder's ordinary bands faint just because the top smeared", () => {
        // On a 2% gel everything from 2 kb up piles into one smear carrying most of the lane's
        // DNA. Judging faintness against that would report a perfectly normal ladder as three
        // invisible bands.
        const { bands } = layoutLane(LADDERS[0], at(2.0));
        const resolved = bands.filter(b => !b.unresolved);

        expect(resolved.length).toBeGreaterThanOrEqual(3);
        expect(resolved.every(b => !b.faint)).toBe(true);
    });

    it("keeps intensity within range even when a pile-up outweighs every real band", () => {
        const { bands } = layoutLane(LADDERS[0], at(2.0));
        for (const band of bands) {
            expect(band.intensity).toBeGreaterThan(0);
            expect(band.intensity).toBeLessThanOrEqual(1);
        }
    });

    it("flags bands the gel cannot size", () => {
        const lane = laneFromLengths("l", "d", "digest", [40000, 3000, 60]);
        const { bands } = layoutLane(lane, at(1.0));

        expect(bands.find(b => b.sizes[0] === 40000)?.unresolved).toBe(true);
        expect(bands.find(b => b.sizes[0] === 3000)?.unresolved).toBe(false);
        expect(bands.find(b => b.sizes[0] === 60)?.unresolved).toBe(true);
    });

    it("changes what separates when the agarose changes", () => {
        const lane = laneFromLengths("l", "d", "digest", [300, 200]);

        // 1% cannot size either — both are below its window, so they pile together.
        expect(layoutLane(lane, at(1.0)).bands).toHaveLength(1);
        // 2% resolves them into two.
        expect(layoutLane(lane, at(2.0)).bands).toHaveLength(2);
    });

    it("ignores zero-length and negative bands", () => {
        const lane: Lane = {
            id: "l", name: "d", kind: "digest",
            bands: [{ bp: 1000, copies: 1 }, { bp: 0, copies: 1 }, { bp: -5, copies: 1 }],
        };
        expect(layoutLane(lane, at(1.0)).bands).toHaveLength(1);
    });

    it("handles an empty lane", () => {
        expect(layoutLane(laneFromLengths("l", "d", "digest", []), at(1.0)).bands).toEqual([]);
    });
});

describe("ladders", () => {
    it("ships three, each in descending order and within a sane size range", () => {
        expect(LADDERS).toHaveLength(3);
        for (const ladder of LADDERS) {
            expect(ladder.kind).toBe("ladder");
            expect(ladder.bands.length).toBeGreaterThan(5);
            for (const band of ladder.bands) {
                expect(band.bp).toBeGreaterThan(0);
                expect(band.bp).toBeLessThanOrEqual(50000);
            }
        }
    });

    it("gives λ/HindIII the fragment sizes HindIII actually produces", () => {
        const lambda = LADDERS.find(l => l.id === "ladder-lambda-hindiii")!;
        const sizes = lambda.bands.map(b => b.bp);

        expect(sizes).toEqual([23130, 9416, 6557, 4361, 2322, 2027, 564, 125]);
        // A complete digest accounts for the whole molecule, so the fragments must sum to the
        // lambda genome exactly. That they do is the check that these eight numbers are right
        // and that none is missing.
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(48502);
    });

    it("loses λ's small fragments on a 0.5% gel and recovers them on a 1% one", () => {
        const lambda = LADDERS.find(l => l.id === "ladder-lambda-hindiii")!;

        // 0.5% agarose does not resolve below 1 kb, so 564 and 125 both run to the front and
        // arrive as a single uninformative smear.
        const coarse = layoutLane(lambda, at(0.5)).bands.find(b => b.sizes.includes(564))!;
        expect(coarse.sizes).toContain(125);
        expect(coarse.unresolved).toBe(true);

        // 1% brings 564 back inside the window; 125 is still below it.
        const fine = layoutLane(lambda, at(1.0)).bands.find(b => b.sizes.includes(564))!;
        expect(fine.sizes).toEqual([564]);
        expect(fine.unresolved).toBe(false);
    });

    it("cannot size λ's largest fragment on a 1% gel", () => {
        const lambda = LADDERS.find(l => l.id === "ladder-lambda-hindiii")!;
        const bands = layoutLane(lambda, at(1.0)).bands;

        // 23 kb is past what 1% separates — it sits below the well carrying no size information.
        expect(bands.find(b => b.sizes.includes(23130))?.unresolved).toBe(true);
        expect(bands.find(b => b.sizes.includes(9416))?.unresolved).toBe(false);
    });
});

describe("resolutionAt", () => {
    it("gets coarser as fragments get bigger", () => {
        expect(resolutionAt(5000, at(1.0))).toBeGreaterThan(resolutionAt(1000, at(1.0)));
    });

    it("is undefined outside the gel's window", () => {
        expect(resolutionAt(40000, at(1.0))).toBe(Infinity);
        expect(resolutionAt(10, at(1.0))).toBe(Infinity);
    });

    it("agrees with what layoutLane merges", () => {
        const gap = resolutionAt(2000, at(1.0));

        // A pair separated by less than the reported resolution merges…
        const tight = laneFromLengths("a", "a", "digest", [2000, 2000 + Math.floor(gap * 0.5)]);
        expect(layoutLane(tight, at(1.0)).bands).toHaveLength(1);

        // …and a pair separated by more than it does not.
        const loose = laneFromLengths("b", "b", "digest", [2000, 2000 + Math.ceil(gap * 2)]);
        expect(layoutLane(loose, at(1.0)).bands).toHaveLength(2);
    });
});

describe("layoutGel", () => {
    it("lays out every lane against the same conditions", () => {
        const lanes = [LADDERS[0], laneFromLengths("d", "digest", "digest", [4000, 2000])];
        const placed = layoutGel(lanes, at(1.0));

        expect(placed).toHaveLength(2);
        expect(placed[1].lane.kind).toBe("digest");

        // A 4 kb fragment must line up with the ladder's own 4 kb band.
        const ladder4k = placed[0].bands.find(b => b.sizes.includes(4000))!;
        const sample4k = placed[1].bands.find(b => b.sizes.includes(4000))!;
        expect(sample4k.y).toBeCloseTo(ladder4k.y, 10);
    });
});

describe("laneFromLengths", () => {
    it("carries an anomalous-migration note when given one", () => {
        const lane = laneFromLengths("u", "Uncut", "uncut", [5000], "supercoiled");
        expect(lane.anomalous).toBe("supercoiled");
        expect(laneFromLengths("u", "Uncut", "uncut", [5000]).anomalous).toBeUndefined();
    });
});
