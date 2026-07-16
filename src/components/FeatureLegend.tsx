import Box from "@mui/joy/Box";
import Typography from "@mui/joy/Typography";
import { CATEGORY_VAR, CATEGORY_LABEL, type FeatureCategory } from "../utils/featureStyle";

interface FeatureLegendProps {
    categories: FeatureCategory[];
}

// Only the feature types actually present in the loaded tracks, so the legend never lists a
// color the map does not use.
export function FeatureLegend({ categories }: FeatureLegendProps) {
    if (categories.length === 0) return null;

    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', px: 0.5 }}>
            {categories.map(category => (
                <Box key={category} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '3px',
                            flexShrink: 0,
                            bgcolor: `var(${CATEGORY_VAR[category]})`,
                        }}
                    />
                    <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                        {CATEGORY_LABEL[category]}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}
