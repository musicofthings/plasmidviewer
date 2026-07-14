import { describe, it, expect } from "vitest";
import {
    niceTickStep, generateTicks, formatBp, assignLanes, laneCount,
    cullToViewport, stackTracks, RULER_HEIGHT,
} from "./layout";
import type { Feature } from "../models/plasmid";

function feature(id: string, name: string, start: number, end: number): Feature {
    return { id, name, type: "CDS", start, end, strand: "+" };
}

describe("niceTickStep", () => {
    it("snaps to 1/2/5 x 10^n", () => {
        expect(niceTickStep(100, 10)).toBe(10);
        expect(niceTickStep(1000, 10)).toBe(100);
        expect(niceTickStep(3000, 10)).toBe(500);
        expect(niceTickStep(7000, 10)).toBe(1000);
    });

    it("never returns a step below 1 bp", () => {
        expect(niceTickStep(5, 10)).toBeGreaterThanOrEqual(1);
    });
});

describe("generateTicks", () => {
    it("places ticks on round numbers inside the viewport", () => {
        const bpToPx = (bp: number) => (bp - 1) * 10;
        const ticks = generateTicks(1, 100, bpToPx);

        expect(ticks.map(t => t.bp)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
        expect(ticks[0].x).toBe(90); // (10 - 1) * 10
    });

    it("does not emit ticks before the start of the sequence", () => {
        const ticks = generateTicks(1, 50, (bp) => bp);
        expect(ticks.every(t => t.bp >= 1)).toBe(true);
    });

    it("stays inside a panned viewport", () => {
        const ticks = generateTicks(457, 557, (bp) => bp);
        expect(ticks.every(t => t.bp >= 457 && t.bp <= 557)).toBe(true);
    });
});

describe("formatBp", () => {
    it("abbreviates round thousands", () => {
        expect(formatBp(1000)).toBe("1k");
        expect(formatBp(12000)).toBe("12k");
        expect(formatBp(1234)).toBe("1234");
        expect(formatBp(50)).toBe("50");
    });
});

describe("assignLanes", () => {
    const PX_PER_BP = 1; // 1 px per bp keeps the arithmetic obvious

    it("keeps well-separated features in a single lane", () => {
        const laidOut = assignLanes([
            feature("a", "A", 1, 100),
            feature("b", "B", 500, 600),
        ], PX_PER_BP);

        expect(laneCount(laidOut)).toBe(1);
        expect(laidOut.every(f => f.lane === 0)).toBe(true);
    });

    it("pushes overlapping features onto separate lanes", () => {
        const laidOut = assignLanes([
            feature("a", "A", 1, 100),
            feature("b", "B", 50, 150),
            feature("c", "C", 80, 200),
        ], PX_PER_BP);

        expect(laneCount(laidOut)).toBe(3);
        expect(new Set(laidOut.map(f => f.lane)).size).toBe(3);
    });

    it("reserves room for a label that does not fit inside its glyph", () => {
        // A 2 bp glyph is 2 px wide and cannot hold "LongFeatureName", so the label spills to
        // the right. A feature starting 20 px later would collide with that label, and must
        // therefore be pushed to a second lane even though the glyphs themselves do not touch.
        const laidOut = assignLanes([
            feature("a", "LongFeatureName", 1, 2),
            feature("b", "B", 20, 25),
        ], PX_PER_BP);

        expect(laidOut.find(f => f.feature.id === "a")!.labelPlacement).toBe("right");
        expect(laneCount(laidOut)).toBe(2);
    });

    it("marks a label as inside when the glyph is wide enough", () => {
        const laidOut = assignLanes([feature("a", "AB", 1, 400)], PX_PER_BP);
        expect(laidOut[0].labelPlacement).toBe("inside");
    });

    it("flips a label to the left when it would be clipped by the right edge", () => {
        // A narrow glyph hard against the right edge of a 500 px container has no room for a
        // right-hand label, so it must render to the left instead of being cut off.
        const laidOut = assignLanes([feature("a", "LongFeatureName", 495, 497)], PX_PER_BP, 500);
        expect(laidOut[0].labelPlacement).toBe("left");
    });

    it("keeps the label on the right when there is room for it", () => {
        const laidOut = assignLanes([feature("a", "Short", 10, 12)], PX_PER_BP, 500);
        expect(laidOut[0].labelPlacement).toBe("right");
    });

    it("packs against a left-flipped label's extent, not just its glyph", () => {
        // "a" flips left, so its label occupies roughly x=445..495. "b" sits inside that span
        // and must be pushed to another lane even though the glyphs do not overlap.
        const laidOut = assignLanes([
            feature("a", "LongFeatureName", 495, 497),
            feature("b", "B", 470, 480),
        ], PX_PER_BP, 500);
        expect(laneCount(laidOut)).toBe(2);
    });

    it("reuses a lane once the previous feature has ended", () => {
        const laidOut = assignLanes([
            feature("a", "A", 1, 100),
            feature("b", "B", 50, 150),   // forced to lane 1
            feature("c", "C", 300, 400),  // lane 0 is free again by here
        ], PX_PER_BP);

        expect(laidOut.find(f => f.feature.id === "c")!.lane).toBe(0);
        expect(laneCount(laidOut)).toBe(2);
    });

    it("assigns the same lanes regardless of where the viewport sits", () => {
        // The whole point of laying out in track-local space (FR-9): panning must not be able
        // to reflow the lanes, so the layout does not depend on the viewport at all.
        const features = [
            feature("a", "A", 1, 100),
            feature("b", "B", 50, 150),
            feature("c", "C", 300, 400),
        ];

        const lanes = assignLanes(features, PX_PER_BP).map(f => [f.feature.id, f.lane]);
        const again = assignLanes(features, PX_PER_BP).map(f => [f.feature.id, f.lane]);

        expect(again).toEqual(lanes);
    });
});

describe("cullToViewport", () => {
    const laidOut = assignLanes([
        feature("left", "Left", 1, 50),
        feature("mid", "Mid", 500, 550),
        feature("right", "Right", 5000, 5050),
    ], 1);

    const ids = (fs: ReturnType<typeof assignLanes>) => fs.map(f => f.feature.id).sort();

    it("drops features that are far outside the container", () => {
        // Container is 0..600 px; "right" sits at 4999..5050 px, well beyond the cull margin.
        const visible = cullToViewport(laidOut, 0, 600);
        expect(ids(visible)).toEqual(["left", "mid"]);
    });

    it("keeps a feature that has been panned off the left edge but is still within slack", () => {
        // originPx = -520 puts "mid" at -21..29 px — still on screen.
        const visible = cullToViewport(laidOut, -520, 600);
        expect(ids(visible)).toContain("mid");
    });

    it("keeps a just-offscreen feature so its spilled label does not pop", () => {
        // "mid" starts 499 px past a 400 px container — outside it, but inside the 250 px
        // margin, so it must survive the cull or its right-hand label would flicker mid-pan.
        const visible = cullToViewport(laidOut, 0, 400);
        expect(ids(visible)).toContain("mid");
    });

    it("cannot change the lanes it was given", () => {
        const visible = cullToViewport(laidOut, 0, 600);
        for (const f of visible) {
            expect(f.lane).toBe(laidOut.find(l => l.feature.id === f.feature.id)!.lane);
        }
    });
});

describe("stackTracks", () => {
    it("stacks tracks below the ruler without overlapping", () => {
        const { boxes, totalHeight } = stackTracks([
            { lanes: 1, hasDiff: false, seqRows: 1 },
            { lanes: 3, hasDiff: true, seqRows: 5 },
        ]);

        expect(boxes[0].y).toBe(RULER_HEIGHT);
        expect(boxes[1].y).toBe(boxes[0].y + boxes[0].height);
        expect(totalHeight).toBe(boxes[1].y + boxes[1].height);
    });

    it("gives the reference no diff row and a comparison track one", () => {
        const { boxes } = stackTracks([
            { lanes: 1, hasDiff: false, seqRows: 1 },
            { lanes: 1, hasDiff: true, seqRows: 1 },
        ]);

        expect(boxes[0].diffY).toBeNull();
        expect(boxes[1].diffY).not.toBeNull();
        // The sequence rows sit below the diff row, never on top of it.
        expect(boxes[1].seqY).toBeGreaterThan(boxes[1].diffY!);
    });

    it("grows a track that needs more lanes", () => {
        const [oneLane] = stackTracks([{ lanes: 1, hasDiff: false, seqRows: 1 }]).boxes;
        const [fourLanes] = stackTracks([{ lanes: 4, hasDiff: false, seqRows: 1 }]).boxes;

        expect(fourLanes.height).toBeGreaterThan(oneLane.height);
        expect(fourLanes.seqY).toBeGreaterThan(oneLane.seqY);
    });
});
