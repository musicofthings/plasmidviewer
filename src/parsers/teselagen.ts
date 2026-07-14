import type { Feature, Plasmid } from "../models/plasmid";

// @teselagen/bio-parsers emits 0-based *inclusive* feature ranges: a GenBank
// "CDS 1..30" comes back as {start: 0, end: 29}. Our model is 1-based inclusive,
// so both ends take +1. This is the single boundary where that conversion happens —
// GenBank and SnapGene both route through here so their coordinates cannot drift.
export function featureFromTeselagen(f: TeselagenFeature): Feature {
    return {
        id: f.id || crypto.randomUUID(),
        name: f.name || f.type || "Untitled",
        type: normalizeFeatureType(f.type),
        start: f.start + 1,
        end: f.end + 1,
        strand: f.strand === -1 ? "-" : "+",
    };
}

export function plasmidFromTeselagen(parsed: TeselagenSequence, fallbackName: string): Plasmid {
    const sequence = (parsed.sequence || "").toUpperCase();

    return {
        name: parsed.name || fallbackName,
        length: sequence.length,
        sequence,
        features: (parsed.features || []).map(featureFromTeselagen),
    };
}

export function normalizeFeatureType(type: string | undefined): Feature["type"] {
    const t = (type || "").toLowerCase();
    if (t === "cds" || t === "orf") return "CDS";
    if (t.includes("promoter")) return "promoter";
    if (t.includes("terminator")) return "terminator";
    if (t.includes("resistance") || t.includes("marker")) return "marker";
    return "misc";
}

export interface TeselagenFeature {
    id?: string;
    name?: string;
    type?: string;
    start: number;
    end: number;
    strand?: number;
}

export interface TeselagenSequence {
    name?: string;
    sequence?: string;
    features?: TeselagenFeature[];
}
