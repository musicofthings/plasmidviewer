import type { Plasmid } from "../models/plasmid";

export interface Viewport {
    start: number;
    end: number;
}

export interface Track {
    id: string;
    plasmid: Plasmid;
    /** Shift of this track relative to the reference, in base pairs. Converted to
     *  pixels only at render time, via the shared pxPerBp scale. */
    offsetBp: number;
    color: string;
    isVisible: boolean;
}

export const DEFAULT_WINDOW_BP = 500;
