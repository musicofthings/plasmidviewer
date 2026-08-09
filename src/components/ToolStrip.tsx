import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";

export type ToolColor = "primary" | "danger" | "success" | "warning" | "neutral";

export interface Tool {
    id: string;
    label: string;
    hint: string;
    /** What this tool is currently putting on the map, e.g. "3 cuts". Null when it is idle. */
    badge?: string | null;
    /** The colour this tool draws in, so the badge matches its marks on the map. */
    color: ToolColor;
}

interface ToolStripProps {
    tools: Tool[];
    /** The open tool, or null when the strip is collapsed to just its buttons. */
    active: string | null;
    onChange: (id: string | null) => void;
    children: React.ReactNode;
}

/**
 * One bar for the analysis tools, replacing a column of separately collapsing panels.
 *
 * Two things this buys beyond tidiness. Every tool is visible as a button whether or not it has
 * been used, so a construct that could be cut by a unique enzyme no longer hides that behind a
 * text toggle. And each tab carries a badge in its own colour, so what is currently drawn on the
 * map stays readable even when its controls are closed — closing a panel hides the controls, not
 * the marks.
 */
export function ToolStrip({ tools, active, onChange, children }: ToolStripProps) {
    return (
        <Sheet variant="outlined" sx={{ borderRadius: 'md', overflow: 'hidden' }}>
            <Box
                role="tablist"
                sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5, p: 0.75, flexWrap: 'wrap',
                    borderBottom: active ? '1px solid' : 'none', borderColor: 'divider',
                }}
            >
                {tools.map(tool => {
                    const isOpen = active === tool.id;
                    return (
                        <Button
                            key={tool.id}
                            size="sm"
                            role="tab"
                            aria-selected={isOpen}
                            // Clicking the open tool closes it, so the map can be given the
                            // whole window without losing what the tool put there.
                            onClick={() => onChange(isOpen ? null : tool.id)}
                            variant={isOpen ? "soft" : "plain"}
                            color={isOpen ? "primary" : "neutral"}
                            title={tool.hint}
                            endDecorator={tool.badge
                                ? <Chip size="sm" variant="solid" color={tool.color}>{tool.badge}</Chip>
                                : undefined}
                        >
                            {tool.label}
                        </Button>
                    );
                })}

                <Typography
                    level="body-xs"
                    sx={{ color: 'text.tertiary', ml: 'auto', pr: 1, display: { xs: 'none', md: 'block' } }}
                >
                    {active ? "Click the open tool to collapse it" : "Marks stay on the map while a tool is closed"}
                </Typography>
            </Box>

            {children}
        </Sheet>
    );
}

/** One tool's controls. Kept mounted while hidden so its results stay on the map. */
export function ToolPane({ active, children }: { active: boolean; children: React.ReactNode }) {
    return (
        <Box sx={{ display: active ? 'block' : 'none', p: 1.5 }}>
            {children}
        </Box>
    );
}
