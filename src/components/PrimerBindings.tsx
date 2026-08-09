import type { BindingSite } from "../models/primer";

/** Height of the band reserved below the cut marks for primer arrows and their labels. */
export const PRIMER_BAND_HEIGHT = 30;

const ROW_HEIGHT = 13;
const ARROWHEAD_PX = 5;
const LABEL_CHAR_PX = 6;
const LABEL_PADDING_PX = 8;
const MIN_ARROW_PX = 3;

interface PrimerBindingsProps {
    sites: BindingSite[];
    /** Primer id -> display name, so an arrow can be labelled without carrying the primer. */
    names: Map<string, string>;
    bpToPx: (bp: number) => number;
    viewportStart: number;
    viewportEnd: number;
    /** Length of the reference, needed to split a site that crosses the origin. */
    sequenceLength: number;
}

/** A site that wraps the origin is drawn as two arrows: tail-of-sequence and head-of-sequence. */
function segmentsFor(site: BindingSite, sequenceLength: number): [number, number][] {
    return site.wraps
        ? [[site.start, sequenceLength], [1, site.end]]
        : [[site.start, site.end]];
}

/**
 * Primer binding sites as arrows above the map, pointing the way the polymerase would extend.
 *
 * The arrowhead marks the 3' end — for a reverse primer that is the *left* end of the arrow,
 * which is the whole point of drawing them rather than listing coordinates: a pair of primers
 * facing each other is the thing a user is looking for, and it is visible at a glance.
 *
 * A 5' tail is drawn dashed beyond the annealing region. It pairs with nothing on this template,
 * so it deliberately does not sit on real coordinates — it is a flag that the oligo is longer
 * than the region it binds.
 */
export function PrimerBindings({
    sites, names, bpToPx, viewportStart, viewportEnd, sequenceLength,
}: PrimerBindingsProps) {
    const visible = sites.filter(site => site.wraps
        || (site.end >= viewportStart - 1 && site.start <= viewportEnd + 1));
    if (visible.length === 0) return null;

    // Greedy row packing on label extents, left to right — the same approach EnzymeCuts takes.
    const rowEnds: number[] = [];
    const placed = visible
        .slice()
        .sort((a, b) => a.start - b.start)
        .map(site => {
            const x = bpToPx(site.start);
            const name = names.get(site.primerId) ?? "";
            // A wrapped site is drawn in two pieces; pack it on its label alone rather than on
            // an arrow width that does not describe either piece.
            const arrowPx = site.wraps ? 0 : Math.max(0, bpToPx(site.end + 1) - x);
            const width = Math.max(arrowPx, name.length * LABEL_CHAR_PX) + LABEL_PADDING_PX;
            let row = rowEnds.findIndex(end => end <= x);
            if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
            rowEnds[row] = x + width;
            return { site, name, row };
        });

    return (
        <g>
            {placed.map(({ site, name, row }) => {
                const y = 14 + row * ROW_HEIGHT;
                const forward = site.strand === "+";

                return (
                    <g key={`${site.primerId}-${site.start}-${site.strand}`}>
                        <title>
                            {`${name} · anneals ${site.start}..${site.end} (${site.annealLength} nt`
                                + `${site.tailLength > 0 ? ` + ${site.tailLength} nt 5' tail` : ""})`
                                + `${site.mismatches > 0 ? ` · ${site.mismatches} mismatch` : ""}`
                                + ` · Tm ${Number.isNaN(site.tm) ? "—" : `${site.tm.toFixed(1)} °C`}`
                                + ` · extends ${forward ? "rightward" : "leftward"} from ${site.threePrime}`}
                        </title>

                        {segmentsFor(site, sequenceLength).map(([from, to], segment) => {
                            const left = bpToPx(from);
                            const right = Math.max(bpToPx(to + 1), left + MIN_ARROW_PX);

                            // The arrowhead belongs on the 3' end, and only on the segment that
                            // actually holds it — a wrapped site must not sprout two heads.
                            const headHere = site.wraps
                                ? (forward ? segment === 1 : segment === 0)
                                : true;
                            const headX = forward ? right : left;
                            const tipX = forward ? headX + ARROWHEAD_PX : headX - ARROWHEAD_PX;

                            // The non-annealing tail hangs off the 5' end, away from the head.
                            const tailX = forward ? left : right;
                            const tailTipX = forward
                                ? tailX - ARROWHEAD_PX * 2
                                : tailX + ARROWHEAD_PX * 2;
                            const tailHere = site.tailLength > 0 && (site.wraps
                                ? (forward ? segment === 0 : segment === 1)
                                : true);

                            return (
                                <g key={segment}>
                                    {tailHere && (
                                        <line
                                            x1={tailX} y1={y} x2={tailTipX} y2={y}
                                            stroke="var(--joy-palette-success-500)"
                                            strokeWidth={1.5}
                                            strokeDasharray="2 2"
                                            opacity={0.8}
                                        />
                                    )}
                                    <line
                                        x1={left} y1={y} x2={right} y2={y}
                                        stroke="var(--joy-palette-success-500)"
                                        strokeWidth={2.5}
                                        strokeLinecap="butt"
                                    />
                                    {headHere && (
                                        <polygon
                                            points={`${tipX},${y} ${headX},${y - 3.5} ${headX},${y + 3.5}`}
                                            fill="var(--joy-palette-success-500)"
                                        />
                                    )}
                                </g>
                            );
                        })}

                        <text
                            x={bpToPx(site.start) + 2}
                            y={y - 4}
                            fontSize="10"
                            fontWeight="600"
                            fill="var(--joy-palette-success-600)"
                            style={{ userSelect: 'none', pointerEvents: 'none' }}
                        >
                            {name}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}
