import type { Feature } from "../models/plasmid";
import type { LabelPlacement } from "../utils/layout";
import { featureColor } from "../utils/featureStyle";

interface FeatureGlyphProps {
    feature: Feature;
    startPx: number;
    endPx: number;
    y: number;
    height: number;
    labelPlacement: LabelPlacement;
    selected?: boolean;
    onClick?: (feature: Feature) => void;
    onHover?: (feature: Feature, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
}

const ARROW_HEAD_WIDTH = 10;

export function FeatureGlyph({
    feature, startPx, endPx, y, height, labelPlacement, selected = false, onClick, onHover, onHoverEnd,
}: FeatureGlyphProps) {
    const width = Math.max(endPx - startPx, 2);
    const right = startPx + width;
    const color = featureColor(feature);
    const mid = y + height / 2;

    let d: string;
    if (feature.strand === "+") {
        d = width <= ARROW_HEAD_WIDTH
            ? `M ${startPx} ${y} L ${right} ${mid} L ${startPx} ${y + height} Z`
            : `M ${startPx} ${y} L ${right - ARROW_HEAD_WIDTH} ${y} L ${right} ${mid} L ${right - ARROW_HEAD_WIDTH} ${y + height} L ${startPx} ${y + height} Z`;
    } else {
        d = width <= ARROW_HEAD_WIDTH
            ? `M ${right} ${y} L ${startPx} ${mid} L ${right} ${y + height} Z`
            : `M ${startPx + ARROW_HEAD_WIDTH} ${y} L ${right} ${y} L ${right} ${y + height} L ${startPx + ARROW_HEAD_WIDTH} ${y + height} L ${startPx} ${mid} Z`;
    }

    const describe = `${feature.name} (${feature.type}) ${feature.start}..${feature.end} ${feature.strand}`;

    return (
        <g
            onClick={() => onClick?.(feature)}
            onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // Space would otherwise scroll the page out from under the map.
                e.preventDefault();
                e.stopPropagation();
                onClick?.(feature);
            }}
            // Hover updates on enter/move so the tooltip tracks the cursor; leave clears it.
            onMouseEnter={(e) => onHover?.(feature, e.clientX, e.clientY)}
            onMouseMove={(e) => onHover?.(feature, e.clientX, e.clientY)}
            onMouseLeave={() => onHoverEnd?.()}
            tabIndex={0}
            role="button"
            aria-label={describe}
            aria-pressed={selected}
            style={{ cursor: 'pointer' }}
        >
            <path
                d={d}
                fill={color}
                stroke={selected ? "var(--joy-palette-text-primary)" : "none"}
                strokeWidth={selected ? 2 : 0}
            />
            {labelPlacement === "inside" ? (
                <text
                    x={startPx + width / 2}
                    y={mid}
                    dy=".35em"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="10"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none', userSelect: 'none', textShadow: '0 0 2px rgba(0,0,0,0.55)' }}
                >
                    {feature.name}
                </text>
            ) : (
                // Too narrow to hold its label, so it spills out one side. assignLanes picked
                // the side (flipping left near the right edge) and reserved the space, so the
                // label can neither be clipped nor collide with the next feature.
                <text
                    x={labelPlacement === "right" ? right + 4 : startPx - 4}
                    y={mid}
                    dy=".35em"
                    textAnchor={labelPlacement === "right" ? "start" : "end"}
                    fill="var(--joy-palette-text-primary)"
                    fontSize="10"
                    fontWeight={selected ? "bold" : "normal"}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                    {feature.name}
                </text>
            )}
        </g>
    );
}
