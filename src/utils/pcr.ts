import type { Feature, Plasmid } from "../models/plasmid";
import type { BindingSite, Primer } from "../models/primer";
import type { Amplicon, PcrOptions } from "../models/pcr";
import { DEFAULT_PCR_OPTIONS } from "../models/pcr";
import { findAllBindingSites, type BindingOptions } from "./primers";
import { gcContent, normalisePosition, reverseComplement } from "./sequence";

/**
 * Steps from `a` forward to `b` on a circle of length `n`.
 *
 * Every span below is measured this way rather than by subtraction, because a product that
 * crosses the origin has an end coordinate lower than its start and plain arithmetic reports a
 * negative length for it.
 */
function forwardDistance(a: number, b: number, n: number): number {
    return (((b - a) % n) + n) % n;
}

/** `length` bases from 1-based `start`, wrapping the origin. */
function sliceForward(sequence: string, start: number, length: number): string {
    if (length <= 0) return "";

    const n = sequence.length;
    const from = start - 1;
    if (from + length <= n) return sequence.slice(from, from + length);
    return sequence.slice(from) + sequence.slice(0, from + length - n);
}

/**
 * Maps a template coordinate onto the product, or null when it falls outside.
 *
 * The product's first base is the forward primer's 5' end, so every template position is offset
 * by that primer's tail — the bases it contributed that the template never had.
 */
function toProductCoord(
    templatePos: number, templateStart: number, span: number, tail: number, n: number,
): number | null {
    const offset = forwardDistance(templateStart, templatePos, n);
    return offset >= span ? null : tail + offset + 1;
}

/**
 * Whether a forward and a reverse site face each other closely enough to give a product.
 *
 * Returns the number of template bases *between* the two annealing regions, or null when the
 * pair cannot amplify. On a linear template the reverse site must lie downstream; on a circle it
 * always does in one direction, which is what makes inverse ("around the horn") PCR work.
 */
function middleLength(
    forward: BindingSite, reverse: BindingSite, n: number, circular: boolean,
): number | null {
    if (circular) {
        // Zero distance means the annealing regions abut with no gap; anything less means they
        // overlap, which is a primer dimer rather than a product.
        const gap = forwardDistance(forward.end, reverse.start, n) - 1;
        return gap < 0 ? null : gap;
    }

    const gap = reverse.start - forward.end - 1;
    return gap < 0 ? null : gap;
}

/**
 * Rebases the source construct's annotations onto a product.
 *
 * A feature only survives if it is wholly inside the amplified span. A marker that is half
 * captured is not a marker, and carrying it across at a truncated length would make the product
 * track assert something false about what it encodes.
 */
function transferFeatures(
    plasmid: Plasmid, templateStart: number, span: number, tail: number,
): { features: Feature[]; truncated: string[] } {
    const n = plasmid.length;
    const features: Feature[] = [];
    const truncated: string[] = [];

    for (const feature of plasmid.features) {
        const featureSpan = forwardDistance(feature.start, feature.end, n) + 1;
        const start = toProductCoord(feature.start, templateStart, span, tail, n);
        const end = toProductCoord(feature.end, templateStart, span, tail, n);

        // Both ends inside *and* the feature not longer than the window it appears to fit in —
        // on a circle a long feature can have both endpoints inside the product while its body
        // runs the other way round the plasmid.
        if (start !== null && end !== null && end - start + 1 === featureSpan) {
            features.push({ ...feature, start, end });
        } else if (start !== null || end !== null) {
            truncated.push(feature.name);
        }
    }

    return { features, truncated };
}

export interface SimulateOptions extends Partial<PcrOptions> {
    binding?: Partial<BindingOptions>;
}

/**
 * Every product the given primers would amplify from the construct.
 *
 * Each facing pair of binding sites is one product, so a primer that anneals in several places
 * yields several — which is the point: an unexpected second band is the thing a simulation is
 * supposed to warn about before the bench does.
 */
export function simulatePcr(
    plasmid: Plasmid, primers: Primer[], options: SimulateOptions = {},
): Amplicon[] {
    const { maxProductBp, annealingMargin } = { ...DEFAULT_PCR_OPTIONS, ...options };

    const sequence = plasmid.sequence.toUpperCase();
    const n = sequence.length;
    if (n === 0 || primers.length === 0) return [];

    const circular = plasmid.topology === "circular";
    const byId = new Map(primers.map(p => [p.id, p]));
    const sites = findAllBindingSites(plasmid, primers, options.binding);

    const forwards = sites.filter(s => s.strand === "+");
    const reverses = sites.filter(s => s.strand === "-");

    const amplicons: Amplicon[] = [];

    for (const forward of forwards) {
        for (const reverse of reverses) {
            const middle = middleLength(forward, reverse, n, circular);
            if (middle === null) continue;

            const forwardPrimer = byId.get(forward.primerId);
            const reversePrimer = byId.get(reverse.primerId);
            if (!forwardPrimer || !reversePrimer) continue;

            const forwardSeq = forwardPrimer.sequence.replace(/\s/g, "").toUpperCase();
            const reverseSeq = reversePrimer.sequence.replace(/\s/g, "").toUpperCase();

            const length = forwardSeq.length + middle + reverseSeq.length;
            if (length > maxProductBp) continue;

            // The primers are incorporated, so the product carries *their* bases at both ends —
            // tails included and mismatches spelled the primer's way, not the template's.
            const gapSeq = sliceForward(sequence, normalisePosition(forward.end + 1, n), middle);
            const product = forwardSeq + gapSeq + reverseComplement(reverseSeq);

            const templateStart = forward.start;
            const templateEnd = reverse.end;
            const span = forwardDistance(templateStart, templateEnd, n) + 1;
            const { features, truncated } =
                transferFeatures(plasmid, templateStart, span, forward.tailLength);

            amplicons.push({
                sequence: product,
                length,
                forward,
                reverse,
                forwardName: forwardPrimer.name,
                reverseName: reversePrimer.name,
                templateStart,
                templateEnd,
                wraps: templateEnd < templateStart,
                // The lower of the two anneals is what limits the step; both primers must bind
                // for the product to form.
                annealingTemp: Math.min(forward.tm, reverse.tm) - annealingMargin,
                gc: gcContent(product),
                features,
                truncated,
            });
        }
    }

    return amplicons.sort((a, b) => a.length - b.length
        || a.templateStart - b.templateStart);
}

/**
 * A product as a construct in its own right, so it can be opened as a track or exported.
 *
 * Always linear — a PCR product is a linear duplex however circular its template was — and it
 * carries a `primer_bind` annotation for each primer, so the thing that defines its ends is
 * visible on the map rather than implied.
 */
export function ampliconPlasmid(amplicon: Amplicon, sourceName: string): Plasmid {
    const forwardBind: Feature = {
        id: `pcr-fwd-${amplicon.templateStart}`,
        name: amplicon.forwardName,
        type: "misc",
        rawType: "primer_bind",
        start: 1,
        end: amplicon.forward.annealLength + amplicon.forward.tailLength,
        strand: "+",
        description: `Forward primer · Tm ${amplicon.forward.tm.toFixed(1)} °C`
            + (amplicon.forward.tailLength > 0 ? ` · ${amplicon.forward.tailLength} nt 5' tail` : ""),
    };

    const reverseLength = amplicon.reverse.annealLength + amplicon.reverse.tailLength;
    const reverseBind: Feature = {
        id: `pcr-rev-${amplicon.templateEnd}`,
        name: amplicon.reverseName,
        type: "misc",
        rawType: "primer_bind",
        start: amplicon.length - reverseLength + 1,
        end: amplicon.length,
        strand: "-",
        description: `Reverse primer · Tm ${amplicon.reverse.tm.toFixed(1)} °C`
            + (amplicon.reverse.tailLength > 0 ? ` · ${amplicon.reverse.tailLength} nt 5' tail` : ""),
    };

    return {
        name: `${sourceName} · ${amplicon.forwardName}/${amplicon.reverseName} (${amplicon.length} bp)`,
        length: amplicon.length,
        sequence: amplicon.sequence,
        topology: "linear",
        features: [...amplicon.features, forwardBind, reverseBind],
    };
}

/** A one-line description of a product, for a chip or a list row. */
export function describeAmplicon(amplicon: Amplicon): string {
    const where = amplicon.wraps
        ? `${amplicon.templateStart}→${amplicon.templateEnd} (origin)`
        : `${amplicon.templateStart}–${amplicon.templateEnd}`;
    return `${amplicon.length} bp · ${where}`;
}
