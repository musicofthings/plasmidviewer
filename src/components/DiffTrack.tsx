import type { Mismatch } from "../utils/alignment";
import { DIFF_HEIGHT } from "../utils/layout";

interface DiffTrackProps {
    mismatches: Mismatch[];
    viewportStart: number;
    viewportEnd: number;
    pxPerBp: number;
    /** Maps a *reference* coordinate to viewport x. Diffs are in reference space, so they are
     *  drawn without the track's display offset. */
    bpToPx: (bp: number) => number;
    y: number;
    selected: Mismatch | null;
    onSelect: (mismatch: Mismatch) => void;
}

const MIN_MARK_PX = 3;

export function DiffTrack({
    mismatches, viewportStart, viewportEnd, pxPerBp, bpToPx, y, selected, onSelect,
}: DiffTrackProps) {
    if (mismatches.length === 0) {
        return (
            <text x={0} y={y + 15} fontSize="11" fill="var(--joy-palette-text-tertiary)">
                Identical to reference
            </text>
        );
    }

    const visible = mismatches.filter(m =>
        m.pos + Math.max(m.length, 1) >= viewportStart && m.pos <= viewportEnd
    );

    return (
        <g>
            {visible.map((m, i) => {
                const isSelected = selected != null
                    && selected.pos === m.pos
                    && selected.type === m.type
                    && selected.queryChar === m.queryChar;

                return (
                    <rect
                        key={`${m.type}-${m.pos}-${i}`}
                        x={bpToPx(m.pos)}
                        y={y + 3}
                        // An insertion consumes no reference bases, so it has no width of its
                        // own and is drawn as a thin caret at the junction it sits in.
                        width={Math.max(MIN_MARK_PX, m.length * pxPerBp)}
                        height={DIFF_HEIGHT - 8}
                        rx={2}
                        fill={MISMATCH_COLOR[m.type]}
                        opacity={isSelected ? 1 : 0.85}
                        stroke={isSelected ? "var(--joy-palette-text-primary)" : "none"}
                        strokeWidth={isSelected ? 2 : 0}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onSelect(m)}
                    >
                        <title>{`${m.type.toUpperCase()} at ${m.pos}: ref '${m.refChar}' → query '${m.queryChar}'`}</title>
                    </rect>
                );
            })}
        </g>
    );
}

const MISMATCH_COLOR: Record<Mismatch["type"], string> = {
    sub: "var(--joy-palette-danger-500)",
    ins: "var(--joy-palette-primary-500)",
    // text-primary rather than a fixed neutral: it is dark on light and light on dark, so the
    // deletion mark keeps its contrast in both color schemes.
    del: "var(--joy-palette-text-primary)",
};
