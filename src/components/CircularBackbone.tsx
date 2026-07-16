import type { Feature, Topology } from "../models/plasmid";

interface CircularTrack {
    id: string;
    name: string;
    length: number;
    features: Feature[];
    sequence: string;
}

interface CircularBackboneProps {
    radius: number;
    cx: number;
    cy: number;
    tracks: CircularTrack[];
    /** Angles are computed against this length so every ring shares one coordinate system. */
    totalLength: number;
    /** Reference topology and GC fraction, shown in the hub (FR-12). */
    topology?: Topology;
    gcContent?: number;
    selectedFeatureId?: string;
    onFeatureClick: (feature: Feature, track: CircularTrack) => void;
}

const RING_SPACING = 34;
const FEATURE_STROKE = 9;

export function CircularBackbone({
    radius, cx, cy, tracks, totalLength, topology, gcContent, selectedFeatureId, onFeatureClick,
}: CircularBackboneProps) {
    const pointAt = (bp: number, r: number) => {
        const angle = (bp / totalLength) * 2 * Math.PI - Math.PI / 2; // 0 bp at 12 o'clock
        return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
    };

    const arc = (startBp: number, endBp: number, r: number) => {
        // Feature start..end is 1-based inclusive, so the arc runs from the leading edge of
        // `start` to the trailing edge of `end` — the same convention as the linear map.
        const [x1, y1] = pointAt(startBp - 1, r);
        const [x2, y2] = pointAt(endBp, r);
        const largeArc = (endBp - startBp + 1) > totalLength / 2 ? 1 : 0;
        return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    };

    return (
        <g>
            {tracks.map((track, i) => {
                const ringRadius = radius - i * RING_SPACING;
                if (ringRadius <= 20) return null;

                return (
                    <g key={track.id}>
                        <circle
                            cx={cx}
                            cy={cy}
                            r={ringRadius}
                            fill="none"
                            stroke="var(--joy-palette-neutral-300)"
                            strokeWidth={i === 0 ? 4 : 2}
                        />

                        {track.features.map(f => {
                            const selected = f.id === selectedFeatureId;
                            // + strand rides just outside its ring, − strand just inside.
                            const r = ringRadius + (f.strand === "+" ? 7 : -7);
                            const spanBp = f.end - f.start + 1;

                            return (
                                <g
                                    key={f.id}
                                    onClick={() => onFeatureClick(f, track)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <path
                                        id={`arc-${f.id}`}
                                        d={arc(f.start, f.end, r)}
                                        stroke={getFeatureColor(f.type)}
                                        strokeWidth={selected ? FEATURE_STROKE + 4 : FEATURE_STROKE}
                                        fill="none"
                                    >
                                        <title>{`${f.name} (${f.type}) ${f.start}..${f.end} ${f.strand}`}</title>
                                    </path>
                                    {spanBp > totalLength / 40 && (
                                        <text
                                            dy={-8}
                                            fontSize="10"
                                            fontWeight={selected ? "bold" : "normal"}
                                            fill="var(--joy-palette-text-primary)"
                                            textAnchor="middle"
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <textPath href={`#arc-${f.id}`} startOffset="50%">
                                                {f.name}
                                            </textPath>
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                );
            })}

            {/* Origin marker: a tick at 12 o'clock (base 1) so orientation is unambiguous (FR-12). */}
            <line
                x1={cx}
                y1={cy - radius - 4}
                x2={cx}
                y2={cy - radius - 18}
                stroke="var(--joy-palette-text-secondary)"
                strokeWidth={2}
            />
            <text
                x={cx}
                y={cy - radius - 23}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="var(--joy-palette-text-secondary)"
            >
                1
            </text>

            <text
                x={cx}
                y={cy - 14}
                textAnchor="middle"
                fontSize="15"
                fontWeight="bold"
                fill="var(--joy-palette-text-primary)"
            >
                {tracks[0]?.name}
            </text>
            <text
                x={cx}
                y={cy + 6}
                textAnchor="middle"
                fontSize="12"
                fill="var(--joy-palette-text-tertiary)"
            >
                {`${totalLength} bp${topology ? ` · ${topology}` : ""}`}
            </text>
            {gcContent !== undefined && (
                <text
                    x={cx}
                    y={cy + 24}
                    textAnchor="middle"
                    fontSize="12"
                    fill="var(--joy-palette-text-tertiary)"
                >
                    {`GC ${(gcContent * 100).toFixed(1)}%`}
                </text>
            )}
            {tracks.length > 1 && (
                <text
                    x={cx}
                    y={cy + 42}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--joy-palette-text-tertiary)"
                >
                    {`${tracks.length} tracks`}
                </text>
            )}
        </g>
    );
}

function getFeatureColor(type: Feature["type"]): string {
    switch (type) {
        case "CDS": return "var(--joy-palette-success-500)";
        case "promoter": return "var(--joy-palette-primary-500)";
        case "terminator": return "var(--joy-palette-danger-500)";
        case "marker": return "var(--joy-palette-warning-500)";
        default: return "var(--joy-palette-neutral-500)";
    }
}
