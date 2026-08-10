/** One species of DNA loaded into a lane. */
export interface Band {
    bp: number;
    /** Relative molar amount. A digest yields one copy of every fragment, so these are all 1;
     *  a ladder's bands are deliberately unequal so the reference bands stand out. */
    copies: number;
    /** Overrides the size as the drawn label, e.g. for a ladder's reference band. */
    label?: string;
}

export type LaneKind = "ladder" | "digest" | "pcr" | "uncut";

export interface Lane {
    id: string;
    name: string;
    kind: LaneKind;
    bands: Band[];
    /** Set when the lane's contents do not migrate by length — an uncut circular plasmid is
     *  supercoiled, and supercoiled DNA runs ahead of linear DNA of the same size. */
    anomalous?: string;
}

export interface GelConditions {
    /** Agarose concentration, % w/v. Sets the range of sizes the gel can separate. */
    agarosePercent: number;
}

/**
 * A band placed on the gel.
 *
 * `y` is fractional distance from the well (0) to the dye front (1) — the simulation's only
 * spatial output, so the renderer decides pixel height on its own.
 */
export interface PlacedBand {
    /** Sizes drawn at this position. More than one means they co-migrate and would appear as a
     *  single band on a real gel. */
    sizes: number[];
    y: number;
    /** 0–1, from the DNA mass at this position: signal follows mass, not molarity, so a large
     *  fragment is brighter than a small one present in the same copy number. */
    intensity: number;
    /** True when the size lies outside what this agarose can separate, so the position carries
     *  no size information — it is piled at the well or run down to the front. */
    unresolved: boolean;
    /** True when the band carries too little mass to be seen in practice. */
    faint: boolean;
    label: string;
}

export interface PlacedLane {
    lane: Lane;
    bands: PlacedBand[];
}

export const DEFAULT_CONDITIONS: GelConditions = { agarosePercent: 1.0 };
