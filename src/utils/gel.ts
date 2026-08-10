import type {
    Band, GelConditions, Lane, PlacedBand, PlacedLane,
} from "../models/gel";

/**
 * What each agarose concentration can actually separate, in bp.
 *
 * Standard working ranges. Outside them a gel still runs DNA, it just stops reporting size:
 * everything too large piles just below the well and everything too small runs with the dye
 * front. The simulation says so rather than extrapolating a position that would look precise
 * and mean nothing.
 */
const RESOLVING_RANGES: { percent: number; min: number; max: number }[] = [
    { percent: 0.5, min: 1000, max: 30000 },
    { percent: 0.75, min: 800, max: 12000 },
    { percent: 1.0, min: 500, max: 10000 },
    { percent: 1.25, min: 300, max: 5000 },
    { percent: 1.5, min: 200, max: 3000 },
    { percent: 2.0, min: 50, max: 2000 },
    { percent: 3.0, min: 10, max: 1000 },
];

export const AGAROSE_CHOICES = RESOLVING_RANGES.map(r => r.percent);

/** The size window `percent` agarose separates, interpolated in log space between the table rows. */
export function resolvingRange(percent: number): { min: number; max: number } {
    const first = RESOLVING_RANGES[0];
    const last = RESOLVING_RANGES[RESOLVING_RANGES.length - 1];
    if (percent <= first.percent) return { min: first.min, max: first.max };
    if (percent >= last.percent) return { min: last.min, max: last.max };

    for (let i = 1; i < RESOLVING_RANGES.length; i++) {
        const hi = RESOLVING_RANGES[i];
        const lo = RESOLVING_RANGES[i - 1];
        if (percent > hi.percent) continue;

        // Sizes are log-distributed, so interpolating the logs keeps a half-step between 1% and
        // 1.25% agarose from landing much closer to one end than the other.
        const t = (percent - lo.percent) / (hi.percent - lo.percent);
        const blend = (a: number, b: number) =>
            Math.round(Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a))));
        return { min: blend(lo.min, hi.min), max: blend(lo.max, hi.max) };
    }

    return { min: last.min, max: last.max };
}

// The resolved window is drawn between these fractions, leaving a little gel above the largest
// resolvable band and below the smallest — real lanes do not start at the well or end at the front.
const TOP = 0.06;
const BOTTOM = 0.94;

/**
 * Where a fragment of `bp` sits, as a fraction from well to dye front.
 *
 * Within the resolving window, migration is linear in log(size) — the Southern relationship, and
 * the reason a gel's ladder looks evenly spaced only when its sizes are evenly spaced in logs.
 * Outside the window the position is clamped, and `resolved` says the number is not a measurement.
 *
 * Known simplification: separation is uniform in log across the whole window, whereas a real gel
 * resolves best in the middle of its range and worse at either end. So two sizes near a window's
 * edge may be drawn apart here that would run together on the bench. The window boundaries carry
 * the coarse version of that truth; refining it would need a fit to real mobility data rather
 * than a tidier formula.
 */
export function migrate(
    bp: number, range: { min: number; max: number },
): { y: number; resolved: boolean } {
    if (bp >= range.max) return { y: TOP, resolved: false };
    if (bp <= range.min) return { y: BOTTOM, resolved: false };

    const span = Math.log(range.max) - Math.log(range.min);
    const fraction = (Math.log(range.max) - Math.log(bp)) / span;
    return { y: TOP + fraction * (BOTTOM - TOP), resolved: true };
}

/** Positions closer than this are one band to the eye — 2,017 and 2,027 bp do not separate. */
const CO_MIGRATION = 0.012;

/** Below this share of the lane's brightest band, a band is not realistically visible. */
const FAINT = 0.08;

function formatSize(bp: number): string {
    if (bp >= 10000) return `${(bp / 1000).toFixed(0)} kb`;
    if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`;
    return `${bp}`;
}

/**
 * What to write beside a band.
 *
 * A pile-up gets a bound, not a list. Everything above a gel's window lands in one place, so a
 * 1 kb ladder on a 2% gel would otherwise be labelled "10 kb + 8.0 kb + 6.0 kb + 5.0 kb + …" —
 * text longer than the gel is wide, asserting a precision the position does not carry. The exact
 * sizes stay in `sizes` for the tooltip.
 */
function bandLabel(
    sizes: number[], resolved: boolean, range: { min: number; max: number },
): string {
    if (!resolved) {
        // Which end it piled at tells you which bound applies.
        return sizes[0] >= range.max ? `> ${formatSize(range.max)}` : `< ${formatSize(range.min)}`;
    }
    if (sizes.length > 2) return `${sizes.length} bands`;
    return sizes.map(formatSize).join(" + ");
}

/**
 * Places one lane's bands on the gel.
 *
 * Two things a naive size-to-position mapping gets wrong are handled here. Bands that co-migrate
 * are merged, because a gel cannot show two bands 10 bp apart at 2 kb and pretending otherwise
 * invites reading a doublet that is not there. And intensity follows *mass*, not copy number, so
 * the small fragment of a digest is correctly faint — the usual reason an expected band is
 * missing from a real photograph.
 */
export function layoutLane(lane: Lane, conditions: GelConditions): PlacedLane {
    const range = resolvingRange(conditions.agarosePercent);

    const placed = lane.bands
        .filter(band => band.bp > 0)
        .map(band => {
            const { y, resolved } = migrate(band.bp, range);
            return { band, y, resolved, mass: band.bp * band.copies };
        })
        .sort((a, b) => a.y - b.y);

    // Merge anything that would land on top of its neighbour.
    const groups: { sizes: number[]; labels: string[]; y: number; mass: number; resolved: boolean }[] = [];
    for (const item of placed) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(item.y - last.y) < CO_MIGRATION) {
            last.sizes.push(item.band.bp);
            if (item.band.label) last.labels.push(item.band.label);
            last.mass += item.mass;
            last.resolved = last.resolved && item.resolved;
            continue;
        }
        groups.push({
            sizes: [item.band.bp],
            labels: item.band.label ? [item.band.label] : [],
            y: item.y,
            mass: item.mass,
            resolved: item.resolved,
        });
    }

    // Faintness is judged against the brightest *resolved* band, not against a pile-up. Everything
    // above the window lands in one place and sums to a huge mass, so measuring against it would
    // report an ordinary ladder's lower bands as invisible — which they plainly are not.
    const resolvedMax = groups.reduce((max, g) => (g.resolved ? Math.max(max, g.mass) : max), 0);
    const brightest = resolvedMax > 0
        ? resolvedMax
        : groups.reduce((max, g) => Math.max(max, g.mass), 0);

    const bands: PlacedBand[] = groups.map(group => {
        const share = brightest === 0 ? 0 : group.mass / brightest;
        return {
            sizes: group.sizes,
            y: group.y,
            // Floored well above zero: a band that is faint on a real gel is still drawn, with
            // the `faint` flag carrying the warning instead of it silently vanishing.
            // Capped, because a pile-up can carry more mass than the brightest resolved band and
            // would otherwise push opacity past 1.
            intensity: Math.min(1, 0.22 + 0.78 * Math.sqrt(share)),
            unresolved: !group.resolved,
            faint: share < FAINT,
            label: group.labels.length > 0
                ? group.labels.join(" / ")
                : bandLabel(group.sizes, group.resolved, range),
        };
    });

    return { lane, bands };
}

export function layoutGel(lanes: Lane[], conditions: GelConditions): PlacedLane[] {
    return lanes.map(lane => layoutLane(lane, conditions));
}

/**
 * Molecular-weight markers.
 *
 * These are the nominal compositions the standards are defined by, not any one supplier's
 * catalogue numbers — a given vendor's ladder may differ by a band or by a few bp. λ/HindIII is
 * the exception and is exact: it is simply what HindIII does to the 48,502 bp lambda genome.
 *
 * `copies` encodes the deliberately brighter reference bands that make a ladder readable.
 */
export const LADDERS: Lane[] = [
    {
        id: "ladder-1kb",
        name: "1 kb ladder",
        kind: "ladder",
        bands: [
            { bp: 10000, copies: 1 }, { bp: 8000, copies: 1 }, { bp: 6000, copies: 1 },
            { bp: 5000, copies: 1 }, { bp: 4000, copies: 1 }, { bp: 3000, copies: 3 },
            { bp: 2000, copies: 1 }, { bp: 1500, copies: 1 }, { bp: 1000, copies: 3 },
            { bp: 500, copies: 1 },
        ],
    },
    {
        id: "ladder-100bp",
        name: "100 bp ladder",
        kind: "ladder",
        bands: [
            { bp: 1500, copies: 1 }, { bp: 1000, copies: 1 }, { bp: 900, copies: 1 },
            { bp: 800, copies: 1 }, { bp: 700, copies: 1 }, { bp: 600, copies: 1 },
            { bp: 500, copies: 3 }, { bp: 400, copies: 1 }, { bp: 300, copies: 1 },
            { bp: 200, copies: 1 }, { bp: 100, copies: 1 },
        ],
    },
    {
        id: "ladder-lambda-hindiii",
        name: "λ / HindIII",
        kind: "ladder",
        bands: [
            { bp: 23130, copies: 1 }, { bp: 9416, copies: 1 }, { bp: 6557, copies: 1 },
            { bp: 4361, copies: 1 }, { bp: 2322, copies: 1 }, { bp: 2027, copies: 1 },
            { bp: 564, copies: 1 }, { bp: 125, copies: 1 },
        ],
    },
];

/** Turns a set of fragment lengths into a lane. */
export function laneFromLengths(
    id: string, name: string, kind: Lane["kind"], lengths: number[], anomalous?: string,
): Lane {
    const bands: Band[] = lengths.map(bp => ({ bp, copies: 1 }));
    return { id, name, kind, bands, ...(anomalous ? { anomalous } : {}) };
}

/**
 * The smallest size difference this gel would show as two bands at `bp`.
 *
 * Useful for answering the question a digest actually raises — "will these two fragments
 * separate?" — without making the user eyeball the picture.
 */
export function resolutionAt(bp: number, conditions: GelConditions): number {
    const range = resolvingRange(conditions.agarosePercent);
    const here = migrate(bp, range);
    if (!here.resolved) return Infinity;

    // Walk up in size until the position has moved by one co-migration width.
    const span = Math.log(range.max) - Math.log(range.min);
    const factor = Math.exp((CO_MIGRATION / (BOTTOM - TOP)) * span);
    return Math.round(bp * factor - bp);
}
