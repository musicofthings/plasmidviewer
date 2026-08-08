import type { CutSite } from "../models/enzyme";

/** Height of the band reserved above the ruler for cut marks and their labels. */
export const CUT_BAND_HEIGHT = 32;

interface EnzymeCutsProps {
    cuts: CutSite[];
    bpToPx: (bp: number) => number;
    viewportStart: number;
    viewportEnd: number;
    /** Full height of the map below the band, so the tick can rule down through it. */
    mapHeight: number;
}

// Labels are ~6px per character at 10px; enough to keep neighbours from overprinting.
const LABEL_CHAR_PX = 6;
const LABEL_PADDING_PX = 6;

/**
 * Cut positions along the top of the map, drawn the way a restriction map is read: a tick at
 * the cut with the enzyme name above it.
 *
 * Labels are packed into rows greedily so that a cluster of sites stays legible instead of
 * overprinting itself — the same approach `assignLanes` takes for feature labels.
 */
export function EnzymeCuts({ cuts, bpToPx, viewportStart, viewportEnd, mapHeight }: EnzymeCutsProps) {
    const visible = cuts.filter(c => c.topCut >= viewportStart - 1 && c.topCut <= viewportEnd + 1);
    if (visible.length === 0) return null;

    // Greedy row packing on label extents, left to right.
    const rowEnds: number[] = [];
    const placed = visible
        .slice()
        .sort((a, b) => a.topCut - b.topCut)
        .map(cut => {
            const x = bpToPx(cut.topCut);
            const width = cut.enzyme.name.length * LABEL_CHAR_PX + LABEL_PADDING_PX;
            let row = rowEnds.findIndex(end => end <= x);
            if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
            rowEnds[row] = x + width;
            return { cut, x, row };
        });

    return (
        <g>
            {placed.map(({ cut, x, row }) => {
                const labelY = 10 + row * 11;
                return (
                    <g key={`${cut.enzyme.name}-${cut.topCut}-${cut.strand}`}>
                        <title>
                            {`${cut.enzyme.name} · cuts after ${cut.topCut} · ${cut.overhangType === "blunt"
                                ? "blunt"
                                : `${Math.abs(cut.overhang)} nt ${cut.overhangType} overhang`}`}
                        </title>
                        {/* The tick rules down through the whole map so the cut can be read
                            against the features it falls inside. */}
                        <line
                            x1={x}
                            y1={labelY + 2}
                            x2={x}
                            y2={CUT_BAND_HEIGHT + mapHeight}
                            stroke="var(--joy-palette-danger-500)"
                            strokeWidth={1}
                            strokeDasharray="2 3"
                            opacity={0.55}
                        />
                        <line
                            x1={x} y1={CUT_BAND_HEIGHT - 6} x2={x} y2={CUT_BAND_HEIGHT}
                            stroke="var(--joy-palette-danger-500)" strokeWidth={2}
                        />
                        <text
                            x={x + 3}
                            y={labelY}
                            fontSize="10"
                            fontWeight="600"
                            fill="var(--joy-palette-danger-500)"
                            style={{ userSelect: 'none', pointerEvents: 'none' }}
                        >
                            {cut.enzyme.name}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}
