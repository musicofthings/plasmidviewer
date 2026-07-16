import type { Plasmid } from "../models/plasmid";
import { complementBase, translateFrame } from "../utils/sequence";
import { SEQ_ROW_HEIGHT } from "../utils/layout";

interface SequenceTrackProps {
    plasmid: Plasmid;
    /** Shift of this track relative to the reference, in base pairs. */
    offsetBp: number;
    viewportStart: number;
    viewportEnd: number;
    pxPerBp: number;
    /** Maps a *reference* coordinate to viewport x. */
    bpToPx: (bp: number) => number;
    y: number;
    showComplement: boolean;
    showTranslation: boolean;
}

// Below this a base is too narrow to hold a readable letter, so we draw colored bars
// instead; below the bar threshold there are more bases than pixels and we say so rather
// than emitting thousands of sub-pixel nodes (FR-9).
export const MIN_PX_FOR_LETTERS = 7;
export const MIN_PX_FOR_BARS = 1.5;
/** A codon needs about this much room before its residue letter is worth drawing. */
const MIN_PX_FOR_RESIDUE = 4;

export function SequenceTrack({
    plasmid, offsetBp, viewportStart, viewportEnd, pxPerBp, bpToPx, y,
    showComplement, showTranslation,
}: SequenceTrackProps) {
    // Which rows this track occupies, top to bottom, matching sequenceRowCount().
    const rowDefs: { label: string; isFrame: boolean }[] = [{ label: "5′→3′", isFrame: false }];
    if (showComplement) rowDefs.push({ label: "3′→5′", isFrame: false });
    if (showTranslation) rowDefs.push(
        { label: "frame +1", isFrame: true },
        { label: "frame +2", isFrame: true },
        { label: "frame +3", isFrame: true },
    );

    // Too zoomed out to draw even 1.5px bars: instead of a blank strip, mark each enabled row
    // with a dashed line + label so the reader can see the strand/frames exist, and a tooltip
    // that says how to reveal them.
    if (pxPerBp < MIN_PX_FOR_BARS) {
        const firstRef = Math.max(viewportStart, 1 + offsetBp);
        const lastRef = Math.min(viewportEnd, plasmid.length + offsetBp);
        if (lastRef < firstRef) return null;

        const labelX = bpToPx(firstRef);
        const lineStart = labelX + 56;
        const lineEnd = bpToPx(lastRef + 1);

        return (
            <>
                {rowDefs.map((def, i) => {
                    const rowY = y + i * SEQ_ROW_HEIGHT;
                    const midY = rowY + SEQ_ROW_HEIGHT / 2;
                    const tip = def.isFrame ? "Zoom in to read the translation" : "Zoom in to read bases";
                    return (
                        <g key={def.label}>
                            <title>{tip}</title>
                            <text
                                x={labelX}
                                y={midY}
                                dy=".32em"
                                fontSize="9"
                                fill="var(--joy-palette-text-tertiary)"
                                style={{ pointerEvents: 'none', userSelect: 'none' }}
                            >
                                {def.label}
                            </text>
                            {lineEnd > lineStart && (
                                <line
                                    x1={lineStart}
                                    y1={midY}
                                    x2={lineEnd}
                                    y2={midY}
                                    stroke="var(--joy-palette-neutral-400)"
                                    strokeWidth={2}
                                    strokeDasharray="2 4"
                                    strokeLinecap="round"
                                    opacity={0.7}
                                />
                            )}
                        </g>
                    );
                })}
            </>
        );
    }

    const showLetters = pxPerBp >= MIN_PX_FOR_LETTERS;

    // Only the bases actually on screen are turned into nodes. Walk *reference* coordinates
    // and map each back into this track's own sequence, so an offset track shows the base
    // that really lines up under the reference base above it.
    const from = Math.max(1, Math.floor(viewportStart));
    const to = Math.ceil(viewportEnd);

    const bases: { refBp: number; index: number; char: string }[] = [];
    for (let refBp = from; refBp <= to; refBp++) {
        const index = refBp - offsetBp - 1;
        if (index < 0 || index >= plasmid.sequence.length) continue;
        bases.push({ refBp, index, char: plasmid.sequence[index] });
    }

    const rows: React.ReactNode[] = [];
    let rowY = y;

    rows.push(
        <g key="fwd">
            {bases.map(({ refBp, char }) => renderBase(char, bpToPx(refBp), rowY, pxPerBp, showLetters))}
        </g>
    );
    rowY += SEQ_ROW_HEIGHT;

    if (showComplement) {
        rows.push(
            <g key="cmp" opacity={0.65}>
                {bases.map(({ refBp, char }) =>
                    renderBase(complementBase(char), bpToPx(refBp), rowY, pxPerBp, showLetters))}
            </g>
        );
        rowY += SEQ_ROW_HEIGHT;
    }

    if (showTranslation) {
        for (const frame of [0, 1, 2] as const) {
            rows.push(
                <TranslationRow
                    key={`frame-${frame}`}
                    plasmid={plasmid}
                    offsetBp={offsetBp}
                    frame={frame}
                    fromIndex={bases[0]?.index ?? 0}
                    toIndex={bases[bases.length - 1]?.index ?? -1}
                    pxPerBp={pxPerBp}
                    bpToPx={bpToPx}
                    y={rowY}
                />
            );
            rowY += SEQ_ROW_HEIGHT;
        }
    }

    return <>{rows}</>;
}

function renderBase(char: string, x: number, y: number, pxPerBp: number, showLetters: boolean) {
    const color = getBaseColor(char);
    const key = `${x}-${y}`;

    return showLetters ? (
        <text
            key={key}
            x={x + pxPerBp / 2}
            y={y + SEQ_ROW_HEIGHT / 2}
            dy=".35em"
            textAnchor="middle"
            fontSize="11"
            fontFamily="'Roboto Mono', monospace"
            fontWeight="bold"
            fill={color}
        >
            {char}
        </text>
    ) : (
        <rect
            key={key}
            x={x}
            y={y + 2}
            width={Math.max(pxPerBp, 1)}
            height={SEQ_ROW_HEIGHT - 4}
            fill={color}
        />
    );
}

interface TranslationRowProps {
    plasmid: Plasmid;
    offsetBp: number;
    frame: 0 | 1 | 2;
    fromIndex: number;
    toIndex: number;
    pxPerBp: number;
    bpToPx: (bp: number) => number;
    y: number;
}

function TranslationRow({
    plasmid, offsetBp, frame, fromIndex, toIndex, pxPerBp, bpToPx, y,
}: TranslationRowProps) {
    if (toIndex < fromIndex) return null;

    // Translate only the codons overlapping the view. Codons are anchored to the frame, so
    // snap the start back to the nearest codon boundary rather than to the viewport edge —
    // otherwise the reading frame would shift as you pan.
    const firstCodon = Math.max(0, Math.floor((fromIndex - frame) / 3));
    const lastCodon = Math.floor((toIndex - frame) / 3);

    const slice = plasmid.sequence.slice(frame + firstCodon * 3, frame + (lastCodon + 1) * 3);
    const residues = translateFrame(slice, 0);
    const showLetters = pxPerBp * 3 >= MIN_PX_FOR_RESIDUE * 3;

    return (
        <g>
            {residues.map((residue, i) => {
                // Back to this track's 1-based coordinates, then into reference space.
                const codonStartBp = frame + (firstCodon + i) * 3 + 1;
                const x = bpToPx(codonStartBp + offsetBp);
                const width = 3 * pxPerBp;
                const isStop = residue.aa === "*";
                const isStart = residue.aa === "M";

                return (
                    <g key={codonStartBp}>
                        <rect
                            x={x + 0.5}
                            y={y + 2}
                            width={Math.max(width - 1, 0.5)}
                            height={SEQ_ROW_HEIGHT - 4}
                            fill={isStop
                                ? "var(--joy-palette-danger-500)"
                                : isStart
                                    ? "var(--joy-palette-success-500)"
                                    : "var(--joy-palette-neutral-300)"}
                            opacity={isStop || isStart ? 0.85 : 0.35}
                        >
                            <title>{`${residue.aa} · frame ${frame + 1} · ${codonStartBp}..${codonStartBp + 2}`}</title>
                        </rect>
                        {showLetters && width >= 7 && (
                            <text
                                x={x + width / 2}
                                y={y + SEQ_ROW_HEIGHT / 2}
                                dy=".35em"
                                textAnchor="middle"
                                fontSize="10"
                                fontFamily="'Roboto Mono', monospace"
                                fill="var(--joy-palette-text-primary)"
                                style={{ pointerEvents: 'none' }}
                            >
                                {residue.aa}
                            </text>
                        )}
                    </g>
                );
            })}
        </g>
    );
}

function getBaseColor(base: string) {
    switch (base.toUpperCase()) {
        case 'A': return 'var(--joy-palette-danger-500)';
        case 'T': return 'var(--joy-palette-success-500)';
        case 'G': return 'var(--joy-palette-warning-500)';
        case 'C': return 'var(--joy-palette-primary-500)';
        default: return 'var(--joy-palette-neutral-500)';
    }
}
