import { useMemo, useState, useEffect } from "react";
import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Input from "@mui/joy/Input";
import Button from "@mui/joy/Button";
import ButtonGroup from "@mui/joy/ButtonGroup";
import IconButton from "@mui/joy/IconButton";
import Typography from "@mui/joy/Typography";
import Chip from "@mui/joy/Chip";
import type { Plasmid } from "../models/plasmid";
import {
    searchPlasmid, detectSearchKind, describeHit, type SearchHit, type SearchKind,
} from "../utils/search";

interface SearchPanelProps {
    plasmid: Plasmid;
    /** Index of the hit currently framed on the map, so the chip list can mark it. */
    activeIndex: number;
    onResults: (hits: SearchHit[]) => void;
    onActivate: (index: number) => void;
}

const KINDS: { value: SearchKind; label: string; hint: string }[] = [
    { value: "dna", label: "DNA", hint: "Nucleotide motif — IUPAC codes allowed, both strands searched" },
    { value: "protein", label: "Protein", hint: "Peptide — searched across all six reading frames" },
    { value: "feature", label: "Features", hint: "Match a feature's name, type, or description" },
];

export function SearchPanel({ plasmid, activeIndex, onResults, onActivate }: SearchPanelProps) {
    const [query, setQuery] = useState("");
    // null means "follow what the query looks like"; picking a chip pins the choice.
    const [pinnedKind, setPinnedKind] = useState<SearchKind | null>(null);

    const kind = pinnedKind ?? detectSearchKind(query);

    const results = useMemo(
        () => (query.trim() ? searchPlasmid(plasmid, query, kind) : []),
        [plasmid, query, kind],
    );

    useEffect(() => { onResults(results); }, [results, onResults]);

    const step = (delta: 1 | -1) => {
        if (results.length === 0) return;
        onActivate((activeIndex + delta + results.length) % results.length);
    };

    const invalidDna = kind === "dna" && query.trim().length > 0
        && !/^[ACGTURYSWKMBDHVN\s]+$/i.test(query);

    return (
        <Sheet variant="outlined" sx={{ p: 1.5, borderRadius: 'md', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                    size="sm"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
                        else if (e.key === "Escape") { setQuery(""); setPinnedKind(null); }
                    }}
                    placeholder="Search sequence, peptide, or feature…"
                    sx={{ flex: 1, minWidth: 220, fontFamily: 'code' }}
                    slotProps={{ input: { 'aria-label': 'Search', spellCheck: false, autoCapitalize: 'off' } }}
                />

                <ButtonGroup size="sm" variant="outlined">
                    {KINDS.map(k => (
                        <Button
                            key={k.value}
                            onClick={() => setPinnedKind(k.value)}
                            color={kind === k.value ? "primary" : "neutral"}
                            variant={kind === k.value ? "soft" : "outlined"}
                            aria-pressed={kind === k.value}
                            title={k.hint}
                        >
                            {k.label}
                        </Button>
                    ))}
                </ButtonGroup>

                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <IconButton
                        size="sm" variant="soft" onClick={() => step(-1)}
                        disabled={results.length === 0} aria-label="Previous match" title="Previous match (Shift+Enter)"
                    >‹</IconButton>
                    <IconButton
                        size="sm" variant="soft" onClick={() => step(1)}
                        disabled={results.length === 0} aria-label="Next match" title="Next match (Enter)"
                    >›</IconButton>
                    {query.trim() && (
                        <Button size="sm" variant="plain" color="neutral" onClick={() => { setQuery(""); setPinnedKind(null); }}>
                            Clear
                        </Button>
                    )}
                </Box>
            </Box>

            {query.trim() && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography level="body-xs" sx={{ color: results.length ? 'text.secondary' : 'text.tertiary' }}>
                        {results.length === 0
                            ? (invalidDna ? "Not a nucleotide sequence — try Protein or Features." : "No matches")
                            : `${activeIndex + 1} of ${results.length} match${results.length === 1 ? "" : "es"}`}
                    </Typography>

                    {/* A short, clickable index of hits. Long result sets stay usable via ‹ ›. */}
                    {results.slice(0, 12).map((hit, i) => (
                        <Chip
                            key={`${hit.kind}-${hit.start}-${hit.end}-${hit.strand}-${hit.frame ?? ""}`}
                            size="sm"
                            variant={i === activeIndex ? "solid" : "soft"}
                            color={i === activeIndex ? "primary" : "neutral"}
                            onClick={() => onActivate(i)}
                            sx={{ fontFamily: 'code', cursor: 'pointer' }}
                            title={hit.kind === "feature" ? hit.match : `${hit.match} · ${describeHit(hit)}`}
                        >
                            {hit.kind === "feature" ? hit.match : describeHit(hit)}
                        </Chip>
                    ))}
                    {results.length > 12 && (
                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                            +{results.length - 12} more — use ‹ › to step through them
                        </Typography>
                    )}
                </Box>
            )}
        </Sheet>
    );
}
