import { useEffect, useMemo, useState } from "react";
import Sheet from "@mui/joy/Sheet";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import ButtonGroup from "@mui/joy/ButtonGroup";
import Input from "@mui/joy/Input";
import Select from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";
import type { Plasmid } from "../models/plasmid";
import type { CutSite, EnzymeDatabase } from "../models/enzyme";
import {
    loadEnzymes, summariseDigest, filterByCutCount, fragments, describeCut, suppliersOf,
    type EnzymeSummary,
} from "../utils/enzymes";

interface EnzymePanelProps {
    plasmid: Plasmid;
    /** Cut sites for the enzymes the user has switched on, lifted so the map can draw them. */
    onCutsChange: (cuts: CutSite[]) => void;
}

type CutFilter = "unique" | "rare" | "all";

const FILTERS: { value: CutFilter; label: string; hint: string; min: number; max: number }[] = [
    { value: "unique", label: "Unique", hint: "Cuts exactly once — the ones you can clone into", min: 1, max: 1 },
    { value: "rare", label: "≤ 3 cuts", hint: "Cuts up to three times", min: 1, max: 3 },
    { value: "all", label: "All", hint: "Every enzyme that cuts at all", min: 1, max: Infinity },
];

function formatBases(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`;
}

export function EnzymePanel({ plasmid, onCutsChange }: EnzymePanelProps) {
    const [database, setDatabase] = useState<EnzymeDatabase | null>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<CutFilter>("unique");
    const [supplier, setSupplier] = useState<string>("");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // ~70 kB of REBASE, fetched the first time the panel is opened rather than on page load.
    // Driven from the click rather than an effect: opening the panel is the event, so there is
    // no state to synchronise against.
    const togglePanel = () => {
        setOpen(o => !o);
        if (database || loading) return;
        setLoading(true);
        loadEnzymes()
            .then(setDatabase)
            .catch(() => setError("Could not load the enzyme database"))
            .finally(() => setLoading(false));
    };

    const summaries = useMemo(
        () => (database ? summariseDigest(plasmid, database.enzymes) : []),
        [database, plasmid],
    );

    const shown = useMemo(() => {
        const { min, max } = FILTERS.find(f => f.value === filter)!;
        let list: EnzymeSummary[] = filterByCutCount(summaries, min, max);

        if (supplier) list = list.filter(s => (s.enzyme.suppliers ?? "").includes(supplier));
        if (query.trim()) {
            const needle = query.trim().toLowerCase();
            list = list.filter(s => s.enzyme.name.toLowerCase().includes(needle)
                || s.enzyme.site.toLowerCase().includes(needle));
        }
        return list;
    }, [summaries, filter, supplier, query]);

    // A selected enzyme keeps its cut marks even if a filter change hides its row, so toggling
    // "Unique" does not silently wipe the map.
    const selectedCuts = useMemo(
        () => summaries.filter(s => selected.has(s.enzyme.name)).flatMap(s => s.sites),
        [summaries, selected],
    );

    useEffect(() => { onCutsChange(selectedCuts); }, [selectedCuts, onCutsChange]);

    const digestFragments = useMemo(
        () => (selectedCuts.length > 0 ? fragments(selectedCuts, plasmid.length, plasmid.topology) : []),
        [selectedCuts, plasmid.length, plasmid.topology],
    );

    const toggle = (name: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name); else next.add(name);
        return next;
    });

    return (
        <Sheet variant="outlined" sx={{ p: 1.5, borderRadius: 'md' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={togglePanel}
                    aria-expanded={open}
                >
                    {open ? "▾" : "▸"} Restriction enzymes
                </Button>

                {database && (
                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        {summaries.length} of {database.enzymes.length} cut this construct
                    </Typography>
                )}
                {loading && <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>Loading REBASE…</Typography>}
                {error && <Typography level="body-xs" color="danger">{error}</Typography>}

                {selected.size > 0 && (
                    <Chip
                        size="sm" variant="soft" color="danger" sx={{ ml: 'auto' }}
                        onClick={() => setSelected(new Set())}
                        title="Clear the selected enzymes"
                    >
                        {selectedCuts.length} cut{selectedCuts.length === 1 ? "" : "s"} shown · clear
                    </Chip>
                )}
            </Box>

            {open && database && (
                <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ButtonGroup size="sm" variant="outlined">
                            {FILTERS.map(f => (
                                <Button
                                    key={f.value}
                                    onClick={() => setFilter(f.value)}
                                    color={filter === f.value ? "primary" : "neutral"}
                                    variant={filter === f.value ? "soft" : "outlined"}
                                    aria-pressed={filter === f.value}
                                    title={f.hint}
                                >
                                    {f.label}
                                </Button>
                            ))}
                        </ButtonGroup>

                        <Select
                            size="sm"
                            value={supplier}
                            onChange={(_, v) => setSupplier(v ?? "")}
                            sx={{ minWidth: 190 }}
                            slotProps={{ button: { 'aria-label': 'Filter by supplier' } }}
                        >
                            <Option value="">Any supplier</Option>
                            {Object.entries(database.suppliers).map(([code, name]) => (
                                <Option key={code} value={code}>{name}</Option>
                            ))}
                        </Select>

                        <Input
                            size="sm"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter by name or site…"
                            sx={{ flex: 1, minWidth: 160 }}
                            slotProps={{ input: { 'aria-label': 'Filter enzymes', spellCheck: false } }}
                        />
                    </Box>

                    <Box sx={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {shown.length === 0 ? (
                            <Typography level="body-xs" sx={{ color: 'text.tertiary', p: 1 }}>
                                No enzyme matches those filters.
                            </Typography>
                        ) : shown.map(({ enzyme, cuts, sites }) => {
                            const isOn = selected.has(enzyme.name);
                            return (
                                <Box
                                    key={enzyme.name}
                                    onClick={() => toggle(enzyme.name)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(enzyme.name); }
                                    }}
                                    aria-pressed={isOn}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: '3px',
                                        borderRadius: 'sm', cursor: 'pointer',
                                        bgcolor: isOn ? 'danger.softBg' : 'transparent',
                                        '&:hover': { bgcolor: isOn ? 'danger.softBg' : 'neutral.softBg' },
                                    }}
                                    title={suppliersOf(enzyme, database).join(", ") || "No listed supplier"}
                                >
                                    <Typography level="body-xs" sx={{ fontWeight: isOn ? 700 : 500, minWidth: 88 }}>
                                        {enzyme.name}
                                    </Typography>
                                    <Typography level="body-xs" sx={{ fontFamily: 'code', color: 'text.secondary', minWidth: 168 }}>
                                        {describeCut(enzyme)}
                                    </Typography>
                                    <Chip size="sm" variant="soft" color={cuts === 1 ? "primary" : "neutral"}>
                                        {cuts}×
                                    </Chip>
                                    <Typography level="body-xs" sx={{ fontFamily: 'code', color: 'text.tertiary', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                        {sites.slice(0, 6).map(s => s.topCut).join(", ")}{sites.length > 6 ? " …" : ""}
                                    </Typography>
                                    {enzyme.cognateMethylation && (
                                        <Chip size="sm" variant="outlined" color="warning" sx={{ ml: 'auto' }}
                                            title={`Cognate methyltransferase target: ${enzyme.cognateMethylation}`}>
                                            me
                                        </Chip>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>

                    {digestFragments.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', pt: 0.5 }}>
                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                {digestFragments.length} fragment{digestFragments.length === 1 ? "" : "s"}:
                            </Typography>
                            {digestFragments.slice(0, 14).map((f, i) => (
                                <Chip key={`${f.start}-${f.end}-${i}`} size="sm" variant="soft"
                                    sx={{ fontFamily: 'code' }}
                                    title={`${f.start}..${f.end}${f.wraps ? " (wraps origin)" : ""}`}>
                                    {formatBases(f.length)}
                                </Chip>
                            ))}
                            {digestFragments.length > 14 && (
                                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                    +{digestFragments.length - 14} more
                                </Typography>
                            )}
                        </Box>
                    )}

                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        Enzyme data: REBASE v{database.version} — {database.copyright}
                    </Typography>
                </Box>
            )}
        </Sheet>
    );
}
