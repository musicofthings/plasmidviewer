import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";
import type { Feature } from "../models/plasmid";
import { featureColor, featureTypeLabel } from "../utils/featureStyle";

export interface HoverState {
    feature: Feature;
    trackName: string;
    /** Cursor position in viewport (client) coordinates. */
    x: number;
    y: number;
}

interface FeatureTooltipProps {
    hover: HoverState | null;
}

const WIDTH = 260;
const OFFSET = 16;

// A fixed-position tooltip so one instance serves both the linear and circular SVGs regardless
// of their containers. pointerEvents: none keeps it from stealing the hover it is describing.
export function FeatureTooltip({ hover }: FeatureTooltipProps) {
    if (!hover) return null;

    const { feature, trackName, x, y } = hover;
    const length = feature.end - feature.start + 1;

    // Flip to the other side of the cursor when it would overflow the viewport edge.
    const flipX = typeof window !== "undefined" && x + OFFSET + WIDTH > window.innerWidth;
    const left = flipX ? x - OFFSET - WIDTH : x + OFFSET;
    const top = typeof window !== "undefined" && y + 160 > window.innerHeight ? y - OFFSET - 140 : y + OFFSET;

    return (
        <Sheet
            variant="outlined"
            sx={{
                position: 'fixed',
                left,
                top,
                width: WIDTH,
                p: 1.25,
                borderRadius: 'md',
                boxShadow: 'md',
                zIndex: 2000,
                pointerEvents: 'none',
                borderLeft: '4px solid',
                borderLeftColor: featureColor(feature),
            }}
        >
            <Typography level="title-sm" sx={{ wordBreak: 'break-word' }}>{feature.name}</Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, my: 0.5 }}>
                <Chip size="sm" variant="soft" sx={{ borderRadius: 'sm' }}>{featureTypeLabel(feature)}</Chip>
                <Chip size="sm" variant="soft" sx={{ borderRadius: 'sm' }}>
                    {feature.strand === "+" ? "→ forward" : "← reverse"}
                </Chip>
            </Box>

            <Typography level="body-xs" sx={{ fontFamily: 'code', color: 'text.tertiary' }}>
                {`${feature.start.toLocaleString()}..${feature.end.toLocaleString()} · ${length.toLocaleString()} bp`}
            </Typography>

            {feature.description && (
                <Typography level="body-xs" sx={{ mt: 0.5, color: 'text.secondary' }}>
                    {feature.description}
                </Typography>
            )}

            <Typography level="body-xs" sx={{ mt: 0.5, color: 'text.tertiary' }}>
                {trackName}
            </Typography>
        </Sheet>
    );
}
