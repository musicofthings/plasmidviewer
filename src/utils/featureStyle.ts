import type { Feature } from "../models/plasmid";

// One category per visually distinct color. `type` collapses to five buckets for the glyph
// shape, but coloring keys on the verbatim `rawType` where we have it, so an origin and a
// primer (both "misc" as far as shape goes) still get their own hue.
export type FeatureCategory =
    | "cds" | "promoter" | "terminator" | "marker" | "origin" | "primer" | "ltr" | "misc";

const CATEGORY_ORDER: FeatureCategory[] = [
    "cds", "promoter", "terminator", "marker", "origin", "primer", "ltr", "misc",
];

// Colors live in index.css as --feat-* custom properties with light and dark values, so the
// theme toggle and the SVG export both resolve them correctly.
export const CATEGORY_VAR: Record<FeatureCategory, string> = {
    cds: "--feat-cds",
    promoter: "--feat-promoter",
    terminator: "--feat-terminator",
    marker: "--feat-marker",
    origin: "--feat-origin",
    primer: "--feat-primer",
    ltr: "--feat-ltr",
    misc: "--feat-misc",
};

export const CATEGORY_LABEL: Record<FeatureCategory, string> = {
    cds: "CDS / gene",
    promoter: "Promoter",
    terminator: "Terminator",
    marker: "Marker / resistance",
    origin: "Origin",
    primer: "Primer / binding",
    ltr: "LTR / repeat",
    misc: "Other",
};

export function featureCategory(feature: Pick<Feature, "type" | "rawType">): FeatureCategory {
    const raw = (feature.rawType || "").toLowerCase();

    if (raw.includes("origin") || raw === "ori" || raw === "orit") return "origin";
    if (raw === "primer_bind" || raw === "protein_bind" || raw.includes("binding")) return "primer";
    if (raw === "ltr" || raw === "repeat_region") return "ltr";

    switch (feature.type) {
        case "CDS": return "cds";
        case "promoter": return "promoter";
        case "terminator": return "terminator";
        case "marker": return "marker";
        default: return "misc";
    }
}

export function featureColor(feature: Pick<Feature, "type" | "rawType">): string {
    return `var(${CATEGORY_VAR[featureCategory(feature)]})`;
}

/** What to show as the feature's type — the verbatim file type when we have it. */
export function featureTypeLabel(feature: Pick<Feature, "type" | "rawType">): string {
    return feature.rawType || feature.type;
}

/** The categories present in a set of features, in a stable legend order. */
export function categoriesPresent(features: Pick<Feature, "type" | "rawType">[]): FeatureCategory[] {
    const present = new Set(features.map(featureCategory));
    return CATEGORY_ORDER.filter(c => present.has(c));
}
