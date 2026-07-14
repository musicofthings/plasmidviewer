import { generateTicks, formatBp, RULER_HEIGHT } from "../utils/layout";

interface RulerProps {
    viewportStart: number;
    viewportEnd: number;
    width: number;
    bpToPx: (bp: number) => number;
    height?: number;
}

const LABEL_MARGIN_PX = 18;

/**
 * The bp ruler, as a `<g>` rather than its own `<svg>`: the linear map is a single SVG root so
 * that it can be serialized straight to vector (FR-23), and a nested `<svg>` would carry its own
 * coordinate system into the export.
 */
export function Ruler({ viewportStart, viewportEnd, width, bpToPx, height = RULER_HEIGHT }: RulerProps) {
    const ticks = generateTicks(viewportStart, viewportEnd, bpToPx);

    return (
        <g>
            <line
                x1={0}
                y1={height - 1}
                x2={width}
                y2={height - 1}
                stroke="var(--joy-palette-neutral-400)"
                strokeWidth={1}
            />
            {ticks.map(tick => (
                <g key={tick.bp}>
                    <line
                        x1={tick.x}
                        y1={height - 7}
                        x2={tick.x}
                        y2={height - 1}
                        stroke="var(--joy-palette-neutral-400)"
                        strokeWidth={1}
                    />
                    <text
                        // A tick at the very edge would have its centered label half-clipped
                        // by the container, so nudge the text (not the tick) back into view.
                        x={Math.min(Math.max(tick.x, LABEL_MARGIN_PX), width - LABEL_MARGIN_PX)}
                        y={height - 11}
                        textAnchor="middle"
                        fontSize="10"
                        fill="var(--joy-palette-text-tertiary)"
                        style={{ userSelect: 'none' }}
                    >
                        {formatBp(tick.bp)}
                    </text>
                </g>
            ))}
        </g>
    );
}
