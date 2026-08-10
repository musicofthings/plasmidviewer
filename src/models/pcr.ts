import type { BindingSite } from "./primer";
import type { Feature } from "./plasmid";

/**
 * A product a primer pair would amplify.
 *
 * The sequence is the *primer's* bases at both ends, not the template's. That distinction is the
 * whole point of simulating PCR rather than slicing the template: a cloning primer's 5' tail is
 * absent from the template and present in the product, and a mismatched base is incorporated as
 * the primer spells it. Site-directed mutagenesis depends on exactly that.
 */
export interface Amplicon {
    /** Product sequence, 5'→3' on the strand the forward primer defines. */
    sequence: string;
    length: number;
    forward: BindingSite;
    reverse: BindingSite;
    /** Display names for the two primers, resolved by the caller. */
    forwardName: string;
    reverseName: string;
    /** 1-based inclusive bounds of the *template* the product covers, primer tails excluded.
     *  `start > end` when the product crosses the origin of a circular construct. */
    templateStart: number;
    templateEnd: number;
    wraps: boolean;
    /** Recommended annealing temperature in °C. */
    annealingTemp: number;
    gc: number;
    /** Features of the source construct that fall entirely inside the product, with coordinates
     *  rebased onto it. Partly-covered features are dropped rather than silently truncated. */
    features: Feature[];
    /** Source features that overlap the product but are not wholly contained, by name. Reported
     *  so a half-captured marker is visible rather than simply missing. */
    truncated: string[];
}

export interface PcrOptions {
    /** Longest product reported. A standard polymerase will not give much beyond this, and on a
     *  circular template every facing pair otherwise yields the whole plasmid. */
    maxProductBp: number;
    /** Subtracted from the lower of the two primer Tms to suggest an annealing temperature. */
    annealingMargin: number;
}

export const DEFAULT_PCR_OPTIONS: PcrOptions = {
    maxProductBp: 20_000,
    annealingMargin: 5,
};
