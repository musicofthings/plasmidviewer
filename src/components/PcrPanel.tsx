import { useEffect, useMemo, useState } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Input from "@mui/joy/Input";
import Typography from "@mui/joy/Typography";
import type { Plasmid } from "../models/plasmid";
import type { Primer } from "../models/primer";
import type { Amplicon } from "../models/pcr";
import { DEFAULT_PCR_OPTIONS } from "../models/pcr";
import { simulatePcr, ampliconPlasmid, describeAmplicon } from "../utils/pcr";
import { downloadText } from "../utils/export";
import { toGenBank } from "../parsers/serialize";

interface PcrPanelProps {
    plasmid: Plasmid;
    /** Every primer the primer tool knows about — typed there or read from the file. */
    primers: Primer[];
    /** The current products, lifted so the tab can badge them and the gel can load them into a
     *  lane — a reaction's extra bands are most legible as bands. */
    onProductsChange: (products: Amplicon[]) => void;
    /** Open a product as its own track, so it can be inspected, diffed and exported like any
     *  other construct. The source construct is never modified. */
    onOpenProduct: (product: Plasmid) => void;
}

function formatBp(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2)} kb` : `${n} bp`;
}

/**
 * Simulates PCR from the primers already entered in the primer tool.
 *
 * Read-only, like the rest: products are offered as a new track and as GenBank, never written
 * back into the template. Every facing pair is reported rather than just the intended one,
 * because a second band is the thing worth knowing before the bench tells you.
 */
export function PcrPanel({ plasmid, primers, onProductsChange, onOpenProduct }: PcrPanelProps) {
    // `null` means "every primer", so a newly typed oligo joins the reaction without needing to
    // be switched on. It becomes a real set only once the user narrows it by hand.
    const [selected, setSelected] = useState<Set<string> | null>(null);
    const [tolerateMismatch, setTolerateMismatch] = useState(false);
    const [maxProduct, setMaxProduct] = useState(String(DEFAULT_PCR_OPTIONS.maxProductBp));
    const [opened, setOpened] = useState<string | null>(null);

    const active = useMemo(
        () => (selected === null ? primers : primers.filter(p => selected.has(p.id))),
        [primers, selected],
    );

    const products = useMemo(() => {
        if (active.length === 0) return [];
        const limit = Number(maxProduct);
        return simulatePcr(plasmid, active, {
            maxProductBp: Number.isFinite(limit) && limit > 0
                ? limit
                : DEFAULT_PCR_OPTIONS.maxProductBp,
            binding: { maxMismatches: tolerateMismatch ? 1 : 0 },
        });
    }, [plasmid, active, tolerateMismatch, maxProduct]);

    useEffect(() => { onProductsChange(products); }, [products, onProductsChange]);

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev ?? primers.map(p => p.id));
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const isOn = (id: string) => selected === null || selected.has(id);

    const openProduct = (amplicon: Amplicon, key: string) => {
        onOpenProduct(ampliconPlasmid(amplicon, plasmid.name));
        setOpened(key);
    };

    const download = (amplicon: Amplicon) => {
        const built = ampliconPlasmid(amplicon, plasmid.name);
        const stem = `${plasmid.name.replace(/\s+/g, "_")}_`
            + `${amplicon.forwardName.replace(/\s+/g, "_")}-`
            + `${amplicon.reverseName.replace(/\s+/g, "_")}_${amplicon.length}bp`;
        downloadText(toGenBank(built), `${stem}.gb`, "chemical/seq-na-genbank");
    };

    if (primers.length === 0) {
        return (
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                No primers yet. Add them in the <strong>Primers</strong> tool — anything typed
                there, or recovered from this file's <code>primer_bind</code> annotations, can
                amplify here.
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary', mr: 0.5 }}>
                    In the reaction:
                </Typography>
                {primers.map(primer => (
                    <Chip
                        key={primer.id}
                        size="sm"
                        variant={isOn(primer.id) ? "solid" : "outlined"}
                        color={isOn(primer.id) ? "primary" : "neutral"}
                        onClick={() => toggle(primer.id)}
                        title={primer.sequence}
                        slotProps={{
                            action: {
                                'aria-label': `${primer.name} in the reaction`,
                                'aria-pressed': isOn(primer.id),
                            },
                        }}
                    >
                        {primer.name}
                    </Chip>
                ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                    size="sm"
                    variant={tolerateMismatch ? "soft" : "outlined"}
                    color={tolerateMismatch ? "primary" : "neutral"}
                    onClick={() => setTolerateMismatch(v => !v)}
                    aria-pressed={tolerateMismatch}
                    title="Let a primer prime through one internal mismatch — how site-directed mutagenesis works"
                >
                    Allow 1 mismatch
                </Button>

                <Typography level="body-xs" sx={{ color: 'text.tertiary', ml: 1 }}>
                    Longest product
                </Typography>
                <Input
                    size="sm" type="number" value={maxProduct}
                    onChange={(e) => setMaxProduct(e.target.value)}
                    sx={{ width: 110 }} endDecorator="bp"
                    slotProps={{ input: { 'aria-label': 'Longest product in base pairs', min: 1 } }}
                />
            </Box>

            {products.length === 0 ? (
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    {active.length === 0
                        ? "No primers selected."
                        : active.length === 1
                            ? "No product. A single primer amplifies only if it anneals in both "
                              + "orientations with one site facing the other."
                            : "No product — no pair of these primers faces each other on this "
                              + "template within the length limit."}
                </Typography>
            ) : (
                <>
                    <Typography level="body-xs" sx={{ color: products.length > 1 ? 'warning.500' : 'text.tertiary' }}>
                        {products.length === 1
                            ? "One product."
                            : `${products.length} products — this reaction is not specific.`}
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 300, overflowY: 'auto' }}>
                        {products.map((amplicon, i) => {
                            const key = `${amplicon.forward.primerId}-${amplicon.forward.start}`
                                + `-${amplicon.reverse.primerId}-${amplicon.reverse.end}`;
                            return (
                                <Box
                                    key={key}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
                                        px: 1, py: 0.75, borderRadius: 'sm',
                                        border: '1px solid', borderColor: 'divider',
                                        bgcolor: i === 0 ? 'background.level1' : 'transparent',
                                    }}
                                >
                                    <Typography level="body-xs" sx={{ fontWeight: 700, minWidth: 74, fontFamily: 'code' }}>
                                        {formatBp(amplicon.length)}
                                    </Typography>
                                    <Typography level="body-xs" sx={{ color: 'text.secondary', minWidth: 150 }}>
                                        {amplicon.forwardName} → {amplicon.reverseName}
                                    </Typography>
                                    <Chip size="sm" variant="soft" color="neutral" sx={{ fontFamily: 'code' }}
                                        title="Template span this product covers">
                                        {describeAmplicon(amplicon)}
                                    </Chip>
                                    <Chip size="sm" variant="soft" color="neutral" sx={{ fontFamily: 'code' }}
                                        title="Suggested annealing temperature: 5 °C below the weaker primer's anneal Tm">
                                        Ta {amplicon.annealingTemp.toFixed(1)} °C
                                    </Chip>
                                    <Chip size="sm" variant="soft" color="neutral" sx={{ fontFamily: 'code' }}>
                                        {(amplicon.gc * 100).toFixed(0)}% GC
                                    </Chip>
                                    {amplicon.features.length > 0 && (
                                        <Chip size="sm" variant="soft" color="primary"
                                            title={amplicon.features.map(f => f.name).join(", ")}>
                                            {amplicon.features.length} feature
                                            {amplicon.features.length === 1 ? "" : "s"}
                                        </Chip>
                                    )}
                                    {amplicon.truncated.length > 0 && (
                                        <Chip size="sm" variant="soft" color="warning"
                                            title={`Only partly amplified, so not carried across: ${amplicon.truncated.join(", ")}`}>
                                            {amplicon.truncated.length} cut off
                                        </Chip>
                                    )}

                                    <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
                                        <Button size="sm" variant="outlined" onClick={() => openProduct(amplicon, key)}>
                                            {opened === key ? "Opened" : "Open as track"}
                                        </Button>
                                        <Button size="sm" variant="plain" color="neutral" onClick={() => download(amplicon)}>
                                            GenBank
                                        </Button>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </>
            )}

            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                Products carry the primers' own bases at both ends — 5′ tails included and
                mismatches spelled the primer's way — so a tail added for cloning appears in the
                product even though the template never had it. Features only partly amplified are
                reported rather than carried across at the wrong length. The template is not
                modified.
            </Typography>
        </Box>
    );
}
