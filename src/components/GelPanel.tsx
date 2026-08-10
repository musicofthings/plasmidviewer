import { useMemo, useState } from "react";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Option from "@mui/joy/Option";
import Select from "@mui/joy/Select";
import Typography from "@mui/joy/Typography";
import type { Plasmid } from "../models/plasmid";
import type { CutSite } from "../models/enzyme";
import type { Amplicon } from "../models/pcr";
import type { Lane, PlacedLane } from "../models/gel";
import { DEFAULT_CONDITIONS } from "../models/gel";
import { layoutGel, laneFromLengths, resolvingRange, AGAROSE_CHOICES, LADDERS } from "../utils/gel";
import { fragments } from "../utils/enzymes";

interface GelPanelProps {
    plasmid: Plasmid;
    /** Cut sites the enzyme tool currently has switched on. */
    cutSites: CutSite[];
    /** Products the PCR tool currently predicts. */
    amplicons: Amplicon[];
}

// The drawing is in SVG user units; the container scales it.
const LANE_WIDTH = 68;
const LANE_GAP = 10;
const GEL_TOP = 26;
const GEL_HEIGHT = 300;
const LABEL_GUTTER = 52;

function formatSize(bp: number): string {
    if (bp >= 10000) return `${(bp / 1000).toFixed(0)} kb`;
    if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`;
    return `${bp}`;
}

/**
 * An agarose gel of whatever the enzyme and PCR tools currently predict.
 *
 * Drawn as an inverted (dark-on-light) gel, the way gels are reproduced in print rather than the
 * way they come off a transilluminator — it reads correctly in both colour schemes and prints.
 *
 * The simulation's job is to answer "would I be able to tell these apart?", so the two things it
 * refuses to fake are co-migration and intensity: bands closer than the gel can separate are
 * merged into one, and brightness follows DNA mass, which is why a digest's smallest fragment
 * can be present and still invisible.
 */
export function GelPanel({ plasmid, cutSites, amplicons }: GelPanelProps) {
    const [agarose, setAgarose] = useState(DEFAULT_CONDITIONS.agarosePercent);
    const [ladderId, setLadderId] = useState(LADDERS[0].id);
    const [showUncut, setShowUncut] = useState(true);

    const conditions = useMemo(() => ({ agarosePercent: agarose }), [agarose]);
    const range = useMemo(() => resolvingRange(agarose), [agarose]);

    const lanes = useMemo(() => {
        const out: Lane[] = [];

        const ladder = LADDERS.find(l => l.id === ladderId);
        if (ladder) out.push(ladder);

        if (showUncut) {
            out.push(laneFromLengths(
                "uncut", "Uncut", "uncut", [plasmid.length],
                // Supercoiled DNA runs ahead of linear DNA of the same length, and a prep is
                // usually a mixture of supercoiled, nicked and linear. Placing it by length is
                // the honest default only if we say that is what we did.
                plasmid.topology === "circular"
                    ? "Supercoiled — a circular plasmid does not migrate by length, and a real "
                      + "prep shows several forms. Drawn at its true length."
                    : undefined,
            ));
        }

        if (cutSites.length > 0) {
            const cut = fragments(cutSites, plasmid.length, plasmid.topology);
            const enzymes = [...new Set(cutSites.map(c => c.enzyme.name))].join(" + ");
            out.push(laneFromLengths("digest", enzymes, "digest", cut.map(f => f.length)));
        }

        if (amplicons.length > 0) {
            // One lane, not one per product: they come out of a single reaction, and seeing the
            // extra bands stacked in the same lane is the point.
            out.push(laneFromLengths("pcr", "PCR", "pcr", amplicons.map(a => a.length)));
        }

        return out;
    }, [plasmid, ladderId, showUncut, cutSites, amplicons]);

    const placed = useMemo(() => layoutGel(lanes, conditions), [lanes, conditions]);

    const width = LABEL_GUTTER + lanes.length * (LANE_WIDTH + LANE_GAP);
    const height = GEL_TOP + GEL_HEIGHT + 34;
    const laneX = (i: number) => LABEL_GUTTER + i * (LANE_WIDTH + LANE_GAP);

    const summary = placed
        .filter(p => p.lane.kind !== "ladder")
        .map(p => `${p.lane.name}: ${p.bands.map(b => b.label).join(", ") || "nothing"}`)
        .join(". ");

    if (lanes.length <= 1) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    Nothing to run yet. Switch on an enzyme in the <strong>Enzymes</strong> tool to
                    load a digest, or set up a reaction in <strong>PCR</strong> to load its
                    products — this gel shows whatever those two currently predict.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>Agarose</Typography>
                <Select
                    size="sm" value={agarose} onChange={(_, v) => setAgarose(v ?? 1)}
                    sx={{ minWidth: 92 }}
                    slotProps={{ button: { 'aria-label': 'Agarose percentage' } }}
                >
                    {AGAROSE_CHOICES.map(p => (
                        <Option key={p} value={p}>{p.toFixed(2).replace(/0$/, "")}%</Option>
                    ))}
                </Select>

                <Select
                    size="sm" value={ladderId} onChange={(_, v) => setLadderId(v ?? LADDERS[0].id)}
                    sx={{ minWidth: 150 }}
                    slotProps={{ button: { 'aria-label': 'Molecular-weight marker' } }}
                >
                    {LADDERS.map(l => <Option key={l.id} value={l.id}>{l.name}</Option>)}
                </Select>

                <Button
                    size="sm"
                    variant={showUncut ? "soft" : "outlined"}
                    color={showUncut ? "primary" : "neutral"}
                    onClick={() => setShowUncut(v => !v)}
                    aria-pressed={showUncut}
                >
                    Uncut lane
                </Button>

                <Chip size="sm" variant="soft" color="neutral" sx={{ fontFamily: 'code' }}
                    title="Sizes outside this window run off the top or the front and cannot be measured">
                    separates {formatSize(range.min)}–{formatSize(range.max)}
                </Chip>
            </Box>

            <Box sx={{ overflowX: 'auto' }}>
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    style={{ width: '100%', maxWidth: width * 1.4, height: 'auto' }}
                    role="img"
                    aria-label={`Simulated ${agarose}% agarose gel. ${summary}`}
                >
                    {placed.map((lane, i) => (
                        <GelLane key={lane.lane.id} lane={lane} x={laneX(i)} index={i} />
                    ))}

                    {/* Ladder sizes in the gutter, so every other lane can be read against them. */}
                    {placed[0]?.lane.kind === "ladder" && placed[0].bands.map(band => (
                        <text
                            key={`m-${band.y}`}
                            x={LABEL_GUTTER - 6}
                            y={GEL_TOP + band.y * GEL_HEIGHT + 3}
                            textAnchor="end"
                            fontSize="9"
                            fill="var(--joy-palette-text-tertiary)"
                            style={{ userSelect: 'none' }}
                        >
                            {band.label}
                        </text>
                    ))}
                </svg>
            </Box>

            {placed.some(p => p.lane.anomalous) && (
                <Typography level="body-xs" color="warning">
                    {placed.find(p => p.lane.anomalous)!.lane.anomalous}
                </Typography>
            )}

            {placed.some(p => p.bands.some(b => b.faint)) && (
                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    Bands marked faint carry under a tenth of the DNA of the brightest band in
                    their lane. They are present in the reaction and easy to miss on the bench.
                </Typography>
            )}

            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                Migration is linear in log(size) within the window this agarose separates; outside
                it, position carries no size information and bands are drawn piled at the well or
                run to the dye front. Separation is treated as uniform across the window, so two
                sizes near either edge may be drawn apart here that would run together in practice.
            </Typography>
        </Box>
    );
}

function GelLane({ lane, x, index }: { lane: PlacedLane; x: number; index: number }) {
    const isLadder = lane.lane.kind === "ladder";

    return (
        <g>
            {/* The lane itself: a light channel, so bands read dark-on-light as in print. */}
            <rect
                x={x} y={GEL_TOP} width={LANE_WIDTH} height={GEL_HEIGHT} rx={2}
                fill={index % 2 === 0
                    ? "var(--joy-palette-background-level1)"
                    : "var(--joy-palette-background-surface)"}
                stroke="var(--joy-palette-divider)"
                strokeWidth={1}
            />

            {/* The well. */}
            <rect
                x={x + 8} y={GEL_TOP - 8} width={LANE_WIDTH - 16} height={7} rx={1}
                fill="var(--joy-palette-neutral-softBg)"
                stroke="var(--joy-palette-divider)"
                strokeWidth={0.75}
            />

            {lane.bands.map(band => {
                const y = GEL_TOP + band.y * GEL_HEIGHT;
                // An unresolved band is a pile-up, not a measurement, so it is drawn as a taller
                // and softer smear rather than a crisp line at a precise place.
                const thickness = band.unresolved ? 8 : 4;
                const title = [
                    // Exact sizes here; the drawn label carries the rounded or bounded version.
                    band.sizes.map(bp => bp.toLocaleString()).join(" + ") + " bp",
                    band.sizes.length > 1 ? "co-migrating — one band on a real gel" : null,
                    band.unresolved ? "outside this gel's range: position is not a size" : null,
                    band.faint ? "faint — under a tenth of the lane's brightest band" : null,
                ].filter(Boolean).join(" · ");

                return (
                    <rect
                        key={`${lane.lane.id}-${band.y}`}
                        x={x + 5}
                        y={y - thickness / 2}
                        width={LANE_WIDTH - 10}
                        height={thickness}
                        rx={band.unresolved ? 3 : 1}
                        fill="var(--joy-palette-text-primary)"
                        opacity={band.unresolved ? band.intensity * 0.55 : band.intensity}
                    >
                        <title>{title}</title>
                    </rect>
                );
            })}

            <text
                x={x + LANE_WIDTH / 2}
                y={GEL_TOP + GEL_HEIGHT + 16}
                textAnchor="middle"
                fontSize="10"
                fontWeight={isLadder ? 400 : 600}
                fill={isLadder ? "var(--joy-palette-text-tertiary)" : "var(--joy-palette-text-primary)"}
                style={{ userSelect: 'none' }}
            >
                {lane.lane.name.length > 11 ? `${lane.lane.name.slice(0, 10)}…` : lane.lane.name}
            </text>
        </g>
    );
}
