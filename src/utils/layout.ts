import type { Feature } from "../models/plasmid";

export interface Tick {
    bp: number;
    x: number;
}

/** Rounds up to the next 1/2/5 x 10^n, so tick labels land on readable numbers. */
export function niceTickStep(spanBp: number, targetCount = 10): number {
    const raw = Math.max(1, spanBp / Math.max(1, targetCount));
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;

    let step: number;
    if (normalized <= 1) step = 1;
    else if (normalized <= 2) step = 2;
    else if (normalized <= 5) step = 5;
    else step = 10;

    return step * magnitude;
}

export function generateTicks(
    startBp: number,
    endBp: number,
    bpToPx: (bp: number) => number,
    targetCount = 10,
): Tick[] {
    const step = niceTickStep(endBp - startBp + 1, targetCount);
    const ticks: Tick[] = [];

    const first = Math.max(1, Math.ceil(startBp / step) * step);
    for (let bp = first; bp <= endBp; bp += step) {
        ticks.push({ bp, x: bpToPx(bp) });
    }

    return ticks;
}

export function formatBp(bp: number): string {
    if (bp >= 1_000_000 && bp % 1_000_000 === 0) return `${bp / 1_000_000}M`;
    if (bp >= 1_000 && bp % 1_000 === 0) return `${bp / 1_000}k`;
    return String(bp);
}

/** Where a feature's label is drawn: inside the glyph, or spilling out one side of it. */
export type LabelPlacement = "inside" | "right" | "left";

export interface LaidOutFeature {
    feature: Feature;
    /** Left edge of the glyph, in px, in *track-local* space (x=0 is the track's first base). */
    startPx: number;
    /** Right edge of the glyph — the exclusive end, i.e. bpToLocalPx(end + 1). */
    endPx: number;
    labelPlacement: LabelPlacement;
    lane: number;
}

/** Left edge of 1-based base `bp` in track-local pixel space. */
export function bpToLocalPx(bp: number, pxPerBp: number): number {
    return (bp - 1) * pxPerBp;
}

// Roughly the advance width of the 10px bold label font. Only needs to be close
// enough to keep labels from colliding.
const LABEL_CHAR_PX = 6.2;
const LABEL_PADDING_PX = 10;
const LANE_GAP_PX = 6;

export function labelWidthPx(name: string): number {
    return name.length * LABEL_CHAR_PX + LABEL_PADDING_PX;
}

/**
 * Packs features into horizontal lanes so that neither glyphs nor their labels overlap.
 * Greedy first-fit over features sorted by left edge, which is optimal in lane count for
 * interval graphs and keeps stable, readable rows.
 *
 * Everything here is in **track-local** pixels and depends only on `pxPerBp` — never on where
 * the viewport currently sits. That is deliberate (FR-9): the layout is therefore invariant
 * under panning, so it is recomputed on zoom but not on every pan frame, and features cannot
 * hop between lanes as they scroll in and out of view.
 *
 * `trackLengthBp` is what lets a label at the end of the construct flip to the left of its
 * glyph instead of trailing off the end of the map; the flipped label is then reserved on
 * that side so packing still sees the true extent.
 */
export function assignLanes(
    features: Feature[],
    pxPerBp: number,
    trackLengthBp = Infinity,
): LaidOutFeature[] {
    const trackEndPx = bpToLocalPx(trackLengthBp + 1, pxPerBp);

    const items = features
        .map(feature => {
            const startPx = bpToLocalPx(feature.start, pxPerBp);
            const endPx = bpToLocalPx(feature.end + 1, pxPerBp);
            const labelPx = labelWidthPx(feature.name);

            let labelPlacement: LabelPlacement;
            if (endPx - startPx >= labelPx) labelPlacement = "inside";
            else if (endPx + labelPx <= trackEndPx) labelPlacement = "right";
            else labelPlacement = "left";

            // A label spilling out of the glyph is part of the feature's footprint, so pack
            // against the extent, not the glyph.
            return {
                feature,
                startPx,
                endPx,
                labelPlacement,
                extentStart: labelPlacement === "left" ? startPx - labelPx : startPx,
                extentEnd: labelPlacement === "right" ? endPx + labelPx : endPx,
                lane: 0,
            };
        })
        .sort((a, b) => a.extentStart - b.extentStart || a.extentEnd - b.extentEnd);

    const laneEnds: number[] = [];

    for (const item of items) {
        let lane = laneEnds.findIndex(end => end + LANE_GAP_PX <= item.extentStart);
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(0);
        }
        laneEnds[lane] = item.extentEnd;
        item.lane = lane;
    }

    return items.map(({ feature, startPx, endPx, labelPlacement, lane }) => ({
        feature, startPx, endPx, labelPlacement, lane,
    }));
}

// Labels spill outside their glyph, so cull with slack rather than at the exact edge —
// otherwise a feature just off-screen would drop its label mid-pan.
const CULL_MARGIN_PX = 250;

/**
 * Narrows a laid-out track to the features that can actually appear on screen (FR-9). Lanes
 * are already assigned, so culling here cannot reflow the layout — it only decides what gets
 * turned into SVG nodes.
 *
 * `originPx` is where the track's first base sits in viewport space.
 */
export function cullToViewport(
    laidOut: LaidOutFeature[],
    originPx: number,
    containerWidth: number,
): LaidOutFeature[] {
    return laidOut.filter(f =>
        originPx + f.endPx >= -CULL_MARGIN_PX &&
        originPx + f.startPx <= containerWidth + CULL_MARGIN_PX
    );
}

export function laneCount(laidOut: LaidOutFeature[]): number {
    return laidOut.reduce((max, f) => Math.max(max, f.lane + 1), 0);
}

// ---------------------------------------------------------------------------
// Vertical layout of the linear map.
//
// The map is a single SVG (so that it can be exported as vector, FR-23), which means the
// stacking of ruler / header / glyph lanes / diff row / sequence rows has to be computed
// rather than left to the DOM. These constants and `stackTracks` are the one place that
// happens, shared by the on-screen map and the export.
// ---------------------------------------------------------------------------

export const RULER_HEIGHT = 28;
export const TRACK_HEADER_HEIGHT = 18;
export const BACKBONE_Y = 10;
export const GLYPH_HEIGHT = 16;
export const LANE_HEIGHT = 22;
export const DIFF_HEIGHT = 22;
export const SEQ_ROW_HEIGHT = 15;
export const TRACK_GAP = 12;

export function glyphY(lane: number): number {
    return BACKBONE_Y - GLYPH_HEIGHT / 2 + lane * LANE_HEIGHT;
}

/** Rows the sequence strip occupies: the forward strand, plus complement and 3 frames (FR-14). */
export function sequenceRowCount(showComplement: boolean, showTranslation: boolean): number {
    return 1 + (showComplement ? 1 : 0) + (showTranslation ? 3 : 0);
}

export interface TrackBox {
    /** Top of this track's block, in SVG y. */
    y: number;
    /** y of the track's title text baseline. */
    headerY: number;
    /** y of the glyph/backbone area's origin (lane 0 backbone sits at mapY + BACKBONE_Y). */
    mapY: number;
    /** y of the diff row, or null when this track has no diff (i.e. it is the reference). */
    diffY: number | null;
    /** y of the first sequence row. */
    seqY: number;
    height: number;
}

export interface TrackMetrics {
    lanes: number;
    hasDiff: boolean;
    seqRows: number;
}

/** Stacks tracks below the ruler, returning each one's vertical slots and the total height. */
export function stackTracks(metrics: TrackMetrics[]): { boxes: TrackBox[]; totalHeight: number } {
    const boxes: TrackBox[] = [];
    let y = RULER_HEIGHT;

    for (const { lanes, hasDiff, seqRows } of metrics) {
        const mapHeight = 2 + Math.max(1, lanes) * LANE_HEIGHT + 4;
        const mapY = y + TRACK_HEADER_HEIGHT;
        const diffY = hasDiff ? mapY + mapHeight : null;
        const seqY = (diffY ?? mapY + mapHeight) + (hasDiff ? DIFF_HEIGHT : 0);
        const height = TRACK_HEADER_HEIGHT + mapHeight + (hasDiff ? DIFF_HEIGHT : 0)
            + seqRows * SEQ_ROW_HEIGHT + TRACK_GAP;

        boxes.push({ y, headerY: y + 12, mapY, diffY, seqY, height });
        y += height;
    }

    return { boxes, totalHeight: y };
}
