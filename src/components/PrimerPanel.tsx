import { useEffect, useMemo, useState } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import IconButton from "@mui/joy/IconButton";
import Input from "@mui/joy/Input";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";
import type { Plasmid } from "../models/plasmid";
import type { BindingSite, Primer } from "../models/primer";
import {
    findAllBindingSites, meltingTemp, primerGcPercent, hasGcClamp, primersFromFeatures,
    describeBindingSite,
} from "../utils/primers";

interface PrimerPanelProps {
    plasmid: Plasmid;
    /** Binding sites for the primers the user has switched on, lifted so the map can draw them. */
    onBindingsChange: (sites: BindingSite[]) => void;
    /** Primer id -> name, so the map can label an arrow. */
    onPrimersChange: (names: Map<string, string>) => void;
}

const IUPAC_ONLY = /^[ACGTURYSWKMBDHVN\s]+$/i;

function formatTm(tm: number): string {
    return Number.isNaN(tm) ? "—" : `${tm.toFixed(1)} °C`;
}

export function PrimerPanel({ plasmid, onBindingsChange, onPrimersChange }: PrimerPanelProps) {
    const [typed, setTyped] = useState<Primer[]>([]);
    const [name, setName] = useState("");
    const [sequence, setSequence] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [tolerateMismatch, setTolerateMismatch] = useState(false);

    // Primers the construct already carries as primer_bind annotations. They cost nothing to
    // derive and mean an imported file arrives with its primer set intact.
    const annotated = useMemo(() => primersFromFeatures(plasmid), [plasmid]);
    const primers = useMemo(() => [...annotated, ...typed], [annotated, typed]);

    // Selection is intersected with the primers that currently exist rather than reset when the
    // construct changes: a feature-derived id from the previous file simply matches nothing, and
    // a typed primer — which is the user's own, not the file's — keeps working across a switch.
    const bindings = useMemo(() => {
        const on = primers.filter(p => selected.has(p.id));
        return on.length === 0
            ? []
            : findAllBindingSites(plasmid, on, { maxMismatches: tolerateMismatch ? 1 : 0 });
    }, [plasmid, primers, selected, tolerateMismatch]);

    const siteCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const primer of primers) {
            counts.set(primer.id, findAllBindingSites(
                plasmid, [primer], { maxMismatches: tolerateMismatch ? 1 : 0 },
            ).length);
        }
        return counts;
    }, [plasmid, primers, tolerateMismatch]);

    const names = useMemo(
        () => new Map(primers.map(p => [p.id, p.name])),
        [primers],
    );

    useEffect(() => { onBindingsChange(bindings); }, [bindings, onBindingsChange]);
    useEffect(() => { onPrimersChange(names); }, [names, onPrimersChange]);

    const clean = sequence.replace(/\s/g, "").toUpperCase();
    const invalid = clean.length > 0 && !IUPAC_ONLY.test(clean);
    const canAdd = clean.length > 0 && !invalid;

    const addPrimer = () => {
        if (!canAdd) return;
        const id = `typed:${typed.length}:${clean}`;
        if (primers.some(p => p.id === id)) return;

        setTyped(prev => [...prev, { id, name: name.trim() || `Primer ${prev.length + 1}`, sequence: clean }]);
        setSelected(prev => new Set(prev).add(id));
        setName("");
        setSequence("");
    };

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const remove = (id: string) => {
        setTyped(prev => prev.filter(p => p.id !== id));
        setSelected(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    {primers.length === 0
                        ? "Paste an oligo to see its Tm and where it binds"
                        : `${primers.length} primer${primers.length === 1 ? "" : "s"}`
                          + (annotated.length > 0 ? ` · ${annotated.length} from this file` : "")}
                </Typography>

                {selected.size > 0 && (
                    <Chip
                        size="sm" variant="soft" color="success" sx={{ ml: 'auto' }}
                        onClick={() => setSelected(new Set())}
                        title="Clear the shown primers"
                    >
                        Clear {selected.size} primer{selected.size === 1 ? "" : "s"}
                    </Chip>
                )}
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Input
                            size="sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Name (optional)"
                            sx={{ width: 160 }}
                            slotProps={{ input: { 'aria-label': 'Primer name' } }}
                        />
                        <Input
                            size="sm"
                            value={sequence}
                            onChange={(e) => setSequence(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPrimer(); } }}
                            placeholder="Paste an oligo, 5'→3'…"
                            error={invalid}
                            sx={{ flex: 1, minWidth: 220, fontFamily: 'code' }}
                            slotProps={{ input: { 'aria-label': 'Primer sequence', spellCheck: false, autoCapitalize: 'off' } }}
                        />
                        <Button size="sm" onClick={addPrimer} disabled={!canAdd}>Add</Button>
                    </Box>

                    {clean.length > 0 && (
                        <Typography level="body-xs" sx={{ color: invalid ? 'danger.500' : 'text.tertiary' }}>
                            {invalid
                                ? "Not a nucleotide sequence."
                                : `${clean.length} nt · ${primerGcPercent(clean).toFixed(0)}% GC · `
                                  + `Tm ${formatTm(meltingTemp(clean))}`
                                  + (hasGcClamp(clean) ? " · GC clamp" : " · no GC clamp")}
                        </Typography>
                    )}

                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button
                            size="sm"
                            variant={tolerateMismatch ? "soft" : "outlined"}
                            color={tolerateMismatch ? "primary" : "neutral"}
                            onClick={() => setTolerateMismatch(v => !v)}
                            aria-pressed={tolerateMismatch}
                            title="Read through one mismatch 5' of the 3' anchor — how a mutagenic primer binds"
                        >
                            Allow 1 mismatch
                        </Button>
                    </Box>

                    <Box sx={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {primers.length === 0 ? (
                            <Typography level="body-xs" sx={{ color: 'text.tertiary', p: 1 }}>
                                No primers yet. This construct carries no primer_bind annotations either.
                            </Typography>
                        ) : primers.map(primer => {
                            const isOn = selected.has(primer.id);
                            const sites = siteCounts.get(primer.id) ?? 0;
                            const tm = meltingTemp(primer.sequence);

                            return (
                                <Box
                                    key={primer.id}
                                    onClick={() => toggle(primer.id)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(primer.id); }
                                    }}
                                    aria-pressed={isOn}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: '3px',
                                        borderRadius: 'sm', cursor: 'pointer',
                                        bgcolor: isOn ? 'success.softBg' : 'transparent',
                                        '&:hover': { bgcolor: isOn ? 'success.softBg' : 'neutral.softBg' },
                                    }}
                                    title={primer.sequence}
                                >
                                    <Typography level="body-xs" sx={{ fontWeight: isOn ? 700 : 500, minWidth: 110 }}>
                                        {primer.name}
                                    </Typography>
                                    <Typography
                                        level="body-xs"
                                        sx={{
                                            fontFamily: 'code', color: 'text.secondary', minWidth: 180,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {primer.sequence}
                                    </Typography>
                                    <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 128 }}>
                                        {primer.sequence.length} nt · {primerGcPercent(primer.sequence).toFixed(0)}% GC
                                    </Typography>
                                    <Chip size="sm" variant="soft" color="neutral" sx={{ fontFamily: 'code' }}>
                                        {formatTm(tm)}
                                    </Chip>
                                    <Chip
                                        size="sm"
                                        variant="soft"
                                        color={sites === 1 ? "success" : sites === 0 ? "warning" : "neutral"}
                                        title={sites === 0
                                            ? "Does not anneal anywhere on this construct"
                                            : `Anneals at ${sites} site${sites === 1 ? "" : "s"}`}
                                    >
                                        {sites} site{sites === 1 ? "" : "s"}
                                    </Chip>
                                    {primer.fromFeatureId
                                        ? (
                                            <Chip size="sm" variant="outlined" color="neutral" sx={{ ml: 'auto' }}
                                                title="Read from a primer_bind annotation in the file">
                                                file
                                            </Chip>
                                        ) : (
                                            <IconButton
                                                size="sm"
                                                variant="plain"
                                                color="neutral"
                                                sx={{ ml: 'auto' }}
                                                aria-label={`Remove ${primer.name}`}
                                                title="Remove this primer"
                                                onClick={(e) => { e.stopPropagation(); remove(primer.id); }}
                                            >
                                                ×
                                            </IconButton>
                                        )}
                                </Box>
                            );
                        })}
                    </Box>

                    {bindings.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', pt: 0.5 }}>
                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                Binding sites:
                            </Typography>
                            {bindings.slice(0, 14).map((site, i) => (
                                <Chip
                                    key={`${site.primerId}-${site.start}-${site.strand}-${i}`}
                                    size="sm" variant="soft" color="success"
                                    sx={{ fontFamily: 'code' }}
                                    title={`${names.get(site.primerId) ?? ""} · anneal Tm ${formatTm(site.tm)}`}
                                >
                                    {describeBindingSite(site)}
                                </Chip>
                            ))}
                            {bindings.length > 14 && (
                                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                    +{bindings.length - 14} more
                                </Typography>
                            )}
                        </Box>
                    )}

                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        Tm is nearest-neighbour (SantaLucia 1998) at 0.25 µM primer, 50 mM Na⁺, and is
                        quoted for the annealing region only — a 5′ tail does not pair in the first cycle.
                    </Typography>
                </Box>
        </Box>
    );
}
