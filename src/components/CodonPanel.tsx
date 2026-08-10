import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Input from "@mui/joy/Input";
import Option from "@mui/joy/Option";
import Select from "@mui/joy/Select";
import Typography from "@mui/joy/Typography";
import type { Plasmid } from "../models/plasmid";
import type { CodonTableDatabase, OptimisationStrategy } from "../models/codon";
import {
    loadCodonTables, optimiseCds, cdsRegions, proteinOf, DEFAULT_CONSTRAINTS,
} from "../utils/codonOptimise";
import { downloadText } from "../utils/export";

interface CodonPanelProps {
    plasmid: Plasmid;
    /** True while this tool's tab is open. The codon tables are fetched the first time it is. */
    active: boolean;
    /** How many codons the current result changes, so the tab can badge it. */
    onChangeCount: (changed: number) => void;
}

const STRATEGIES: { value: OptimisationStrategy; label: string; hint: string }[] = [
    {
        value: "highest", label: "Most frequent",
        hint: "Always the host's commonest synonym. Highest CAI, and what most synthesis vendors do",
    },
    {
        value: "matched", label: "Match host usage",
        hint: "Reproduce the host's codon distribution rather than its single favourite",
    },
    {
        value: "rare-only", label: "Replace rare only",
        hint: "Keep the native codon unless the host uses it rarely — the smallest useful edit",
    },
];

// The sites people actually design around, with their recognition sequences taken from the same
// REBASE data the enzyme tool reads. Anything else can be typed into the box beside them.
const PRESETS: { label: string; site: string; note: string }[] = [
    { label: "EcoRI", site: "GAATTC", note: "EcoRI" },
    { label: "BamHI", site: "GGATCC", note: "BamHI" },
    { label: "HindIII", site: "AAGCTT", note: "HindIII" },
    { label: "XhoI", site: "CTCGAG", note: "XhoI" },
    { label: "XbaI", site: "TCTAGA", note: "XbaI" },
    { label: "SalI", site: "GTCGAC", note: "SalI" },
    { label: "NotI", site: "GCGGCCGC", note: "NotI" },
    { label: "NdeI", site: "CATATG", note: "NdeI" },
    { label: "NcoI", site: "CCATGG", note: "NcoI" },
    { label: "BsaI", site: "GGTCTC", note: "BsaI — Golden Gate" },
    { label: "BsmBI", site: "CGTCTC", note: "BsmBI — Golden Gate" },
    { label: "BbsI", site: "GAAGAC", note: "BbsI — Golden Gate" },
    { label: "Shine–Dalgarno", site: "AGGAGG", note: "Internal ribosome binding site, bacterial hosts" },
    { label: "Poly-A signal", site: "AATAAA", note: "Premature polyadenylation, mammalian hosts" },
];

const IUPAC_ONLY = /^[ACGTURYSWKMBDHVN]+$/i;

function pct(fraction: number): string {
    return `${(fraction * 100).toFixed(1)}%`;
}

/** A metric before and after, with the direction of travel made obvious. */
function Metric({ label, before, after, hint, better }: {
    label: string; before: string; after: string; hint: string;
    better?: "up" | "down" | null;
}) {
    return (
        <Box sx={{ minWidth: 108 }} title={hint}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>{label}</Typography>
            <Typography level="body-sm" sx={{ fontFamily: 'code' }}>
                <Box component="span" sx={{ color: 'text.tertiary' }}>{before}</Box>
                {" → "}
                <Box
                    component="span"
                    sx={{
                        fontWeight: 700,
                        color: better === "up" ? 'success.500' : better === "down" ? 'danger.500' : 'text.primary',
                    }}
                >
                    {after}
                </Box>
            </Typography>
        </Box>
    );
}

/**
 * Rewrites a CDS for a chosen expression host's codon usage.
 *
 * Read-only, like every other tool here: the construct is not edited. The result is offered as
 * a download and as text to copy, which is what a synthesis order needs anyway. Writing an
 * optimised CDS back into the construct waits on the mutable document model (FR-31).
 */
export function CodonPanel({ plasmid, active, onChangeCount }: CodonPanelProps) {
    const [tables, setTables] = useState<CodonTableDatabase | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hostId, setHostId] = useState("e_coli");
    const [featureId, setFeatureId] = useState<string | null>(null);
    const [strategy, setStrategy] = useState<OptimisationStrategy>("highest");
    const [avoided, setAvoided] = useState<Set<string>>(new Set());
    const [typedSites, setTypedSites] = useState("");
    const [gcMin, setGcMin] = useState(String(DEFAULT_CONSTRAINTS.gcMin * 100));
    const [gcMax, setGcMax] = useState(String(DEFAULT_CONSTRAINTS.gcMax * 100));
    const [maxRun, setMaxRun] = useState(String(DEFAULT_CONSTRAINTS.maxHomopolymer));
    // The sequence that was copied, not a flag: it lets the button fall back to "Copy sequence"
    // when the result changes underneath it, without an effect to reset it.
    const [copiedSequence, setCopiedSequence] = useState<string | null>(null);

    const requested = useRef(false);
    useEffect(() => {
        if (!active || requested.current) return;
        requested.current = true;
        loadCodonTables()
            .then(setTables)
            .catch(() => setError("Could not load the codon usage tables"));
    }, [active]);

    const loading = active && !tables && !error;

    const regions = useMemo(() => cdsRegions(plasmid), [plasmid]);
    const region = useMemo(
        () => regions.find(r => r.feature.id === featureId) ?? regions[0],
        [regions, featureId],
    );
    const host = tables?.hosts.find(h => h.id === hostId) ?? tables?.hosts[0];

    const constraints = useMemo(() => {
        const extra = typedSites
            .split(/[\s,;]+/)
            .map(s => s.trim().toUpperCase().replace(/U/g, "T"))
            .filter(s => s.length > 1 && IUPAC_ONLY.test(s));

        // A blank or nonsensical bound falls back to the default rather than to zero, so a
        // half-typed number cannot silently switch a constraint off.
        const number = (raw: string, fallback: number) => {
            const value = Number(raw);
            return raw.trim() === "" || Number.isNaN(value) ? fallback : value;
        };

        return {
            ...DEFAULT_CONSTRAINTS,
            avoidSites: [...avoided, ...extra],
            gcMin: number(gcMin, DEFAULT_CONSTRAINTS.gcMin * 100) / 100,
            gcMax: number(gcMax, DEFAULT_CONSTRAINTS.gcMax * 100) / 100,
            maxHomopolymer: number(maxRun, DEFAULT_CONSTRAINTS.maxHomopolymer),
        };
    }, [avoided, typedSites, gcMin, gcMax, maxRun]);

    const result = useMemo(() => {
        if (!host || !region || region.sequence.length < 3) return null;
        return optimiseCds(region.sequence, host, {
            strategy,
            constraints,
            upstream: region.upstream,
            downstream: region.downstream,
        });
    }, [host, region, strategy, constraints]);

    useEffect(() => { onChangeCount(result?.changes.length ?? 0); }, [result, onChangeCount]);
    const copied = result !== null && copiedSequence === result.sequence;

    // The one thing that must never be wrong. It is checked on every render rather than trusted,
    // because a silently altered protein is the failure a user could not detect from the map.
    const proteinHeld = result ? proteinOf(result.sequence) === proteinOf(region!.sequence) : true;

    const toggle = (site: string) => setAvoided(prev => {
        const next = new Set(prev);
        if (next.has(site)) next.delete(site); else next.add(site);
        return next;
    });

    const stem = `${plasmid.name.replace(/\s+/g, "_") || "sequence"}`
        + `_${region?.feature.name.replace(/\s+/g, "_") ?? "cds"}_${hostId}`;

    const download = () => {
        if (!result || !host) return;
        const header = `>${stem} codon-optimised for ${host.name} `
            + `(${strategy}, CAI ${result.before.cai.toFixed(3)}→${result.after.cai.toFixed(3)}, `
            + `${result.changes.length} codons changed)`;
        const wrapped = result.sequence.match(/.{1,60}/g)?.join("\n") ?? "";
        downloadText(`${header}\n${wrapped}\n`, `${stem}.fasta`, "text/x-fasta");
    };

    const copy = () => {
        if (!result) return;
        navigator.clipboard.writeText(result.sequence)
            .then(() => setCopiedSequence(result.sequence))
            .catch(() => setError("Could not copy to the clipboard"));
    };

    if (regions.length === 0) {
        return (
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                This construct has no CDS annotations, so there is nothing to optimise. Import a
                GenBank or SnapGene file that annotates its coding sequences.
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Select
                    size="sm"
                    value={region?.feature.id ?? null}
                    onChange={(_, v) => setFeatureId(v)}
                    sx={{ minWidth: 200 }}
                    slotProps={{ button: { 'aria-label': 'Coding sequence' } }}
                >
                    {regions.map(r => (
                        <Option key={r.feature.id} value={r.feature.id}>
                            {r.feature.name} ({r.sequence.length} bp{r.feature.strand === "-" ? ", −" : ""})
                        </Option>
                    ))}
                </Select>

                <Select
                    size="sm"
                    value={hostId}
                    onChange={(_, v) => setHostId(v ?? "e_coli")}
                    sx={{ minWidth: 190 }}
                    disabled={!tables}
                    slotProps={{ button: { 'aria-label': 'Expression host' } }}
                >
                    {(tables?.hosts ?? []).map(h => (
                        <Option key={h.id} value={h.id} label={h.name} aria-label={`${h.name} — ${h.note}`}>
                            <Box>
                                <Typography level="body-sm">{h.name}</Typography>
                                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                    {h.note}
                                </Typography>
                            </Box>
                        </Option>
                    ))}
                </Select>

                <Select
                    size="sm"
                    value={strategy}
                    onChange={(_, v) => setStrategy(v ?? "highest")}
                    sx={{ minWidth: 170 }}
                    slotProps={{ button: { 'aria-label': 'Optimisation strategy' } }}
                >
                    {STRATEGIES.map(s => (
                        <Option
                            key={s.value} value={s.value} label={s.label} title={s.hint}
                            aria-label={`${s.label} — ${s.hint}`}
                        >
                            <Box>
                                <Typography level="body-sm">{s.label}</Typography>
                                <Typography level="body-xs" sx={{ color: 'text.tertiary', maxWidth: 260, whiteSpace: 'normal' }}>
                                    {s.hint}
                                </Typography>
                            </Box>
                        </Option>
                    ))}
                </Select>

                {loading && (
                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        Loading codon tables…
                    </Typography>
                )}
            </Box>

            {region?.partial && (
                <Typography level="body-xs" color="warning">
                    “{region.feature.name}” is {region.sequence.length} bp, not a whole number of
                    codons — the trailing {region.sequence.length % 3} base
                    {region.sequence.length % 3 === 1 ? "" : "s"} are passed through untouched.
                </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary', mr: 0.5 }}>Keep out:</Typography>
                {PRESETS.map(preset => (
                    <Chip
                        key={preset.label}
                        size="sm"
                        variant={avoided.has(preset.site) ? "solid" : "outlined"}
                        color={avoided.has(preset.site) ? "primary" : "neutral"}
                        onClick={() => toggle(preset.site)}
                        title={`${preset.note} · ${preset.site}`}
                        // Joy renders the clickable part as a bare button behind the label, so
                        // without this it reaches the accessibility tree unnamed.
                        slotProps={{
                            action: {
                                'aria-label': `Keep ${preset.label} (${preset.site}) out of the sequence`,
                                'aria-pressed': avoided.has(preset.site),
                            },
                        }}
                    >
                        {preset.label}
                    </Chip>
                ))}
                <Input
                    size="sm"
                    value={typedSites}
                    onChange={(e) => setTypedSites(e.target.value)}
                    placeholder="or type motifs…"
                    sx={{ width: 170, fontFamily: 'code' }}
                    slotProps={{ input: { 'aria-label': 'Additional motifs to avoid', spellCheck: false } }}
                />
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>GC window</Typography>
                <Input
                    size="sm" type="number" value={gcMin} onChange={(e) => setGcMin(e.target.value)}
                    sx={{ width: 84 }} endDecorator="%"
                    slotProps={{ input: { 'aria-label': 'Minimum GC percent', min: 0, max: 100 } }}
                />
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>to</Typography>
                <Input
                    size="sm" type="number" value={gcMax} onChange={(e) => setGcMax(e.target.value)}
                    sx={{ width: 84 }} endDecorator="%"
                    slotProps={{ input: { 'aria-label': 'Maximum GC percent', min: 0, max: 100 } }}
                />
                <Typography level="body-xs" sx={{ color: 'text.tertiary', ml: 1 }}>
                    Longest single-base run
                </Typography>
                <Input
                    size="sm" type="number" value={maxRun} onChange={(e) => setMaxRun(e.target.value)}
                    sx={{ width: 76 }}
                    slotProps={{ input: { 'aria-label': 'Maximum homopolymer run', min: 1, max: 20 } }}
                />
            </Box>

            {error && <Typography level="body-xs" color="danger">{error}</Typography>}

            {result && host && (
                <>
                    {!proteinHeld && (
                        <Typography level="body-xs" color="danger">
                            The optimised sequence does not translate to the same protein. This is a
                            bug — do not use this result.
                        </Typography>
                    )}

                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <Metric
                            label="CAI"
                            before={result.before.cai.toFixed(3)}
                            after={result.after.cai.toFixed(3)}
                            better={result.after.cai > result.before.cai ? "up" : null}
                            hint="Codon adaptation index against this host's genome-wide usage"
                        />
                        <Metric
                            label="GC"
                            before={pct(result.before.gc)}
                            after={pct(result.after.gc)}
                            hint="Overall GC content"
                        />
                        <Metric
                            label="GC3"
                            before={pct(result.before.gc3)}
                            after={pct(result.after.gc3)}
                            hint="GC at third codon positions, where synonymous choice shows up"
                        />
                        <Metric
                            label="Longest run"
                            before={String(result.before.longestHomopolymer)}
                            after={String(result.after.longestHomopolymer)}
                            better={result.after.longestHomopolymer > constraints.maxHomopolymer ? "down" : null}
                            hint="Longest run of a single base — synthesis vendors reject long ones"
                        />
                        {constraints.avoidSites.length > 0 && (
                            <Metric
                                label="Avoided sites"
                                before={String(result.before.avoidedSiteHits)}
                                after={String(result.after.avoidedSiteHits)}
                                better={result.after.avoidedSiteHits > 0 ? "down" : null}
                                hint="Occurrences of the motifs above, counted on both strands"
                            />
                        )}
                        <Box sx={{ minWidth: 120 }}>
                            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>Codons changed</Typography>
                            <Typography level="body-sm" sx={{ fontFamily: 'code', fontWeight: 700 }}>
                                {result.changes.length} of {Math.floor(region!.sequence.length / 3)}
                            </Typography>
                        </Box>
                    </Box>

                    {result.remaining.length > 0 && (
                        <Box>
                            <Typography level="body-xs" color="warning">
                                {result.remaining.length} constraint
                                {result.remaining.length === 1 ? "" : "s"} could not be met — the
                                protein sequence leaves no synonym that satisfies them:
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                {result.remaining.slice(0, 8).map((v, i) => (
                                    <Chip key={i} size="sm" variant="soft" color="warning" sx={{ fontFamily: 'code' }}>
                                        {v.detail}
                                    </Chip>
                                ))}
                                {result.remaining.length > 8 && (
                                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                        +{result.remaining.length - 8} more
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    )}

                    <Box
                        sx={{
                            fontFamily: 'code', fontSize: 11, lineHeight: 1.5, p: 1,
                            bgcolor: 'background.level1', borderRadius: 'sm',
                            maxHeight: 132, overflowY: 'auto', wordBreak: 'break-all',
                            border: '1px solid', borderColor: 'divider',
                        }}
                    >
                        {result.sequence}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button size="sm" onClick={download} disabled={!proteinHeld}>
                            Download FASTA
                        </Button>
                        <Button size="sm" variant="outlined" onClick={copy} disabled={!proteinHeld}>
                            {copied ? "Copied" : "Copy sequence"}
                        </Button>
                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                            The construct is not modified — this is a sequence to order, not an edit.
                        </Typography>
                    </Box>

                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                        {host.source} · {host.cdsCount.toLocaleString()} CDS,{" "}
                        {host.codonCount.toLocaleString()} codons (Kazusa CUTG).
                        {host.cdsCount < 1000 && (
                            <Box component="span" sx={{ color: 'warning.500' }}>
                                {" "}A small sample — treat these frequencies as indicative.
                            </Box>
                        )}
                        {" "}CAI is computed against genome-wide usage, not a highly-expressed
                        reference set, so compare it between versions of a gene rather than
                        against published CAI values.
                    </Typography>
                </>
            )}
        </Box>
    );
}
