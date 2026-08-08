import type { Plasmid, Strand } from "../models/plasmid";
import type { CutSite, Enzyme, EnzymeDatabase, Fragment } from "../models/enzyme";
import { matchesAt } from "./search";
import { complement, reverseComplement } from "./sequence";

// The database is ~70 kB and only needed once a user opens the enzyme panel, so it is loaded
// on demand rather than bundled into the initial payload — the same treatment the GenBank
// parser gets.
let cached: EnzymeDatabase | null = null;

export async function loadEnzymes(): Promise<EnzymeDatabase> {
    if (!cached) cached = (await import("../data/enzymes.json")).default as EnzymeDatabase;
    return cached;
}

/**
 * Wraps a cut position into 1..length.
 *
 * Type IIS enzymes cut outside their recognition site, so a site near the origin of a circular
 * plasmid produces a raw position of 0, a negative number, or one past the end. On a circular
 * molecule those are real positions on the other side of the origin.
 */
export function normalisePosition(position: number, length: number): number {
    return ((position - 1) % length + length) % length + 1;
}

function overhangTypeOf(overhang: number): CutSite["overhangType"] {
    if (overhang > 0) return "5'";
    if (overhang < 0) return "3'";
    return "blunt";
}

function cutSite(
    enzyme: Enzyme, siteStart: number, strand: Strand, rawTop: number, rawBottom: number,
    length: number, topology: Plasmid["topology"],
): CutSite | null {
    // On a linear molecule a cut computed off either end simply does not happen.
    if (topology === "linear" && (rawTop < 1 || rawTop > length || rawBottom < 1 || rawBottom > length)) {
        return null;
    }

    const siteEnd = siteStart + enzyme.site.length - 1;
    const overhang = rawBottom - rawTop;

    return {
        enzyme,
        siteStart,
        siteEnd: siteEnd > length ? siteEnd - length : siteEnd,
        strand,
        topCut: normalisePosition(rawTop, length),
        bottomCut: normalisePosition(rawBottom, length),
        overhang,
        overhangType: overhangTypeOf(overhang),
    };
}

/**
 * Every place `enzyme` cuts `plasmid`, on both strands.
 *
 * A circular construct is scanned past its origin, so a site straddling base 1 is found — the
 * usual reason a cut site goes missing in tools that treat every sequence as linear.
 */
export function findCutSites(plasmid: Plasmid, enzyme: Enzyme): CutSite[] {
    const { sequence, topology } = plasmid;
    const length = sequence.length;
    const siteLength = enzyme.site.length;
    if (siteLength === 0 || siteLength > length) return [];

    const circular = topology === "circular";
    const haystack = circular ? sequence + sequence.slice(0, siteLength - 1) : sequence;
    const sites: CutSite[] = [];

    const rcSite = reverseComplement(enzyme.site);
    const palindromic = rcSite === enzyme.site;

    for (let i = 0; i + siteLength <= haystack.length && i < length; i++) {
        const siteStart = i + 1;

        if (matchesAt(haystack, enzyme.site, i)) {
            // Cut positions are relative to the first base of the site.
            const site = cutSite(
                enzyme, siteStart, "+",
                siteStart - 1 + enzyme.cutTop, siteStart - 1 + enzyme.cutBottom,
                length, topology,
            );
            if (site) sites.push(site);
        }

        // A palindromic site is the same site read either way; reporting it twice would double
        // every fragment count.
        if (!palindromic && matchesAt(haystack, rcSite, i)) {
            // Reading on the minus strand, enzyme base k sits at forward position
            // siteStart + siteLength - k, so a cut after base k falls after the forward
            // position one lower. The enzyme's top-strand cut is the forward bottom cut.
            const anchor = siteStart + siteLength - 1;
            const site = cutSite(
                enzyme, siteStart, "-",
                anchor - enzyme.cutBottom, anchor - enzyme.cutTop,
                length, topology,
            );
            if (site) sites.push(site);
        }
    }

    return sites;
}

/** Cut sites for a set of enzymes, ordered along the sequence. */
export function digest(plasmid: Plasmid, enzymes: Enzyme[]): CutSite[] {
    return enzymes
        .flatMap(enzyme => findCutSites(plasmid, enzyme))
        .sort((a, b) => a.topCut - b.topCut || a.enzyme.name.localeCompare(b.enzyme.name));
}

/**
 * The fragments a digest produces, by size.
 *
 * Fragments are delimited by the top-strand cut. A circular molecule with n cuts yields n
 * fragments; a linear one yields n+1, including the two ends.
 */
export function fragments(cuts: CutSite[], length: number, topology: Plasmid["topology"]): Fragment[] {
    const positions = [...new Set(cuts.map(c => c.topCut))].sort((a, b) => a - b);
    if (positions.length === 0) {
        return [{ start: 1, end: length, length, wraps: false }];
    }

    const out: Fragment[] = [];

    if (topology === "circular") {
        for (let i = 0; i < positions.length; i++) {
            const start = positions[i] + 1;
            const end = positions[(i + 1) % positions.length];
            const wraps = end < start;
            out.push({
                start: start > length ? start - length : start,
                end,
                length: wraps ? length - start + 1 + end : end - start + 1,
                wraps,
            });
        }
    } else {
        let from = 1;
        for (const position of positions) {
            out.push({ start: from, end: position, length: position - from + 1, wraps: false });
            from = position + 1;
        }
        out.push({ start: from, end: length, length: length - from + 1, wraps: false });
    }

    return out.sort((a, b) => b.length - a.length);
}

export interface EnzymeSummary {
    enzyme: Enzyme;
    cuts: number;
    sites: CutSite[];
}

/**
 * How often each enzyme cuts, for the "which enzymes are useful here" question that drives
 * every restriction cloning decision. Enzymes that do not cut at all are omitted.
 */
export function summariseDigest(plasmid: Plasmid, enzymes: Enzyme[]): EnzymeSummary[] {
    return enzymes
        .map(enzyme => {
            const sites = findCutSites(plasmid, enzyme);
            return { enzyme, cuts: sites.length, sites };
        })
        .filter(summary => summary.cuts > 0)
        .sort((a, b) => a.cuts - b.cuts || a.enzyme.name.localeCompare(b.enzyme.name));
}

/** Enzymes cutting between `min` and `max` times — `min: 1, max: 1` is the unique cutters. */
export function filterByCutCount(summaries: EnzymeSummary[], min: number, max: number): EnzymeSummary[] {
    return summaries.filter(s => s.cuts >= min && s.cuts <= max);
}

export function suppliersOf(enzyme: Enzyme, database: EnzymeDatabase): string[] {
    return [...(enzyme.suppliers ?? "")]
        .map(code => database.suppliers[code])
        .filter((name): name is string => Boolean(name));
}

/**
 * The double-stranded cut, rendered the way a catalogue writes it: `G^AATTC / CTTAA^G`.
 *
 * The lower strand is the plain complement, not the reverse complement: it is written 3'->5'
 * underneath the top strand, so its bases stay in register with the ones they pair with and
 * the bottom cut mark sits directly at `cutBottom`.
 */
export function describeCut(enzyme: Enzyme): string {
    const { site, cutTop, cutBottom } = enzyme;

    // Cuts outside the site are written as an offset instead, e.g. GGTCTC(1/5).
    const outside = cutTop < 0 || cutTop > site.length || cutBottom < 0 || cutBottom > site.length;
    if (outside) return `${site}(${cutTop - site.length}/${cutBottom - site.length})`;

    const mark = (text: string, at: number) => `${text.slice(0, at)}^${text.slice(at)}`;
    return `${mark(site, cutTop)} / ${mark(complement(site), cutBottom)}`;
}
