import type { SearchHit } from "../utils/search";

interface SearchHighlightsProps {
    hits: SearchHit[];
    activeIndex: number;
    /** Maps a reference coordinate to viewport x. */
    bpToPx: (bp: number) => number;
    pxPerBp: number;
    height: number;
    /** Length of the reference, needed to split a hit that crosses the origin. */
    sequenceLength: number;
}

/** A hit that wraps the origin is drawn as two bands: tail-of-sequence and head-of-sequence. */
function bandsFor(hit: SearchHit, sequenceLength: number): [number, number][] {
    return hit.wraps
        ? [[hit.start, sequenceLength], [1, hit.end]]
        : [[hit.start, hit.end]];
}

const MIN_BAND_PX = 2;

/**
 * Vertical bands behind the tracks marking every search hit, with the active one emphasised.
 *
 * Drawn first in the SVG so it sits *under* the glyphs and sequence — a highlight that covered
 * the bases it is pointing at would defeat the purpose.
 */
export function SearchHighlights({
    hits, activeIndex, bpToPx, pxPerBp, height, sequenceLength,
}: SearchHighlightsProps) {
    if (hits.length === 0) return null;

    return (
        <g aria-hidden="true">
            {hits.flatMap((hit, i) => {
                const active = i === activeIndex;
                return bandsFor(hit, sequenceLength).map(([from, to], band) => {
                    const x = bpToPx(from);
                    const width = Math.max((to - from + 1) * pxPerBp, MIN_BAND_PX);

                    return (
                        <rect
                            key={`${i}-${band}`}
                            x={x}
                            y={0}
                            width={width}
                            height={height}
                            fill={active
                                ? "var(--joy-palette-warning-400)"
                                : "var(--joy-palette-warning-200)"}
                            opacity={active ? 0.55 : 0.3}
                            stroke={active ? "var(--joy-palette-warning-600)" : "none"}
                            strokeWidth={active ? 1 : 0}
                            rx={2}
                        />
                    );
                });
            })}
        </g>
    );
}
