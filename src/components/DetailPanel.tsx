import { useState } from "react";
import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";
import type { Feature } from "../models/plasmid";
import type { Mismatch } from "../utils/alignment";

export type Selection =
    | { kind: "feature"; feature: Feature; trackName: string; sequence: string }
    | { kind: "mismatch"; mismatch: Mismatch; trackName: string };

interface DetailPanelProps {
    selection: Selection | null;
    onZoomTo: (startBp: number, endBp: number) => void;
    onClear: () => void;
}

export function DetailPanel({ selection, onZoomTo, onClear }: DetailPanelProps) {
    const [copied, setCopied] = useState(false);

    const copySequence = async (sequence: string) => {
        try {
            await navigator.clipboard.writeText(sequence);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied (insecure context, permissions) — the button
            // simply does nothing rather than throwing at the user.
        }
    };

    if (!selection) {
        return (
            <Sheet variant="soft" sx={{ p: 2, borderRadius: 'md', minHeight: 96 }}>
                <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
                    Click a feature or a diff mark to inspect it.
                </Typography>
            </Sheet>
        );
    }

    const rows: [string, string][] = [];
    let title: string;
    let zoomStart: number;
    let zoomEnd: number;

    if (selection.kind === "feature") {
        const f = selection.feature;
        title = f.name;
        zoomStart = f.start;
        zoomEnd = f.end;
        rows.push(
            ["Type", f.type],
            ["Strand", f.strand === "+" ? "+ (forward)" : "− (reverse)"],
            ["Start", `${f.start}`],
            ["End", `${f.end}`],
            ["Length", `${f.end - f.start + 1} bp`],
            ["Track", selection.trackName],
        );
    } else {
        const m = selection.mismatch;
        const label = { sub: "Substitution", ins: "Insertion", del: "Deletion" }[m.type];
        title = `${label} at ${m.pos}`;
        zoomStart = m.pos;
        zoomEnd = m.pos + Math.max(m.length, m.queryChar.length, 1) - 1;
        rows.push(
            ["Position", `${m.pos} (reference)`],
            ["Reference", m.refChar],
            ["Query", m.queryChar],
            ["Reference span", `${m.length} bp`],
            ["Track", selection.trackName],
        );
    }

    return (
        <Sheet variant="outlined" sx={{ p: 2, borderRadius: 'md', minHeight: 96 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
                <Typography level="title-md" sx={{ wordBreak: 'break-word' }}>{title}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    {selection.kind === "feature" && (
                        <Button
                            size="sm"
                            variant="soft"
                            color="neutral"
                            onClick={() => copySequence(selection.sequence)}
                            disabled={selection.sequence.length === 0}
                        >
                            {copied ? "Copied ✓" : "Copy sequence"}
                        </Button>
                    )}
                    <Button size="sm" variant="soft" onClick={() => onZoomTo(zoomStart, zoomEnd)}>
                        Zoom to
                    </Button>
                    <Button size="sm" variant="plain" color="neutral" onClick={onClear}>
                        Close
                    </Button>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {rows.map(([label, value]) => (
                    <Chip key={label} variant="soft" size="sm" sx={{ borderRadius: 'sm' }}>
                        <Typography level="body-xs" component="span" sx={{ color: 'text.tertiary' }}>{label}: </Typography>
                        <Typography level="body-xs" component="span" sx={{ fontFamily: 'code' }}>{value}</Typography>
                    </Chip>
                ))}
            </Box>
        </Sheet>
    );
}
