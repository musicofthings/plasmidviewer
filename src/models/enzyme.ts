import type { Strand } from "./plasmid";

/**
 * A type II restriction enzyme, as REBASE describes it.
 *
 * Cut positions are 1-based indices *into the recognition site*, and the cut falls immediately
 * after the numbered base. They are not clamped to the site: a type IIS enzyme such as BsaI
 * (GGTCTC, 7/11) cuts downstream of its site, and an enzyme with a negative position cuts
 * upstream of it.
 */
export interface Enzyme {
    name: string;
    /** Recognition sequence, uppercase, may contain IUPAC ambiguity codes. */
    site: string;
    cutTop: number;
    cutBottom: number;
    blunt: boolean;
    /** A few enzymes cut on both sides of their site; this is the second pair. */
    cutTop2?: number;
    cutBottom2?: number;
    /** REBASE single-letter supplier codes, e.g. "NEB" is "N". */
    suppliers?: string;
    /** The cognate methyltransferase's target, e.g. "5(6)" — base 5 is N6-methyladenine.
     *  This is REBASE's modification record, not a full sensitivity table. */
    cognateMethylation?: string;
    isoschizomers?: string[];
}

export interface EnzymeDatabase {
    source: string;
    citation: string;
    copyright: string;
    version: string;
    /** Single-letter code -> company name. */
    suppliers: Record<string, string>;
    enzymes: Enzyme[];
}

export interface CutSite {
    enzyme: Enzyme;
    /** 1-based inclusive bounds of the recognition site on the forward sequence. */
    siteStart: number;
    siteEnd: number;
    /** Which strand the recognition sequence reads on. */
    strand: Strand;
    /** 1-based position after which the top strand is cut, normalised into the sequence. */
    topCut: number;
    /** 1-based position after which the bottom strand is cut. */
    bottomCut: number;
    /** bottomCut - topCut: positive is a 5' overhang, negative a 3' overhang, 0 blunt. */
    overhang: number;
    overhangType: "5'" | "3'" | "blunt";
}

export interface Fragment {
    /** 1-based inclusive. On a circular construct a fragment may wrap, so start > end. */
    start: number;
    end: number;
    length: number;
    wraps: boolean;
}
