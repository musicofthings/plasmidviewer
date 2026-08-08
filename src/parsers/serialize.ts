import type { Feature, Plasmid } from "../models/plasmid";

// Writers live next to the readers on purpose: the 1-based-inclusive convention that
// teselagen.ts converts *into* is the one this module has to convert back *out of*, and
// keeping both sides in one place is what stops them drifting apart (FR-35).

const FASTA_LINE = 60;

export function toFasta(plasmid: Plasmid): string {
    const lines: string[] = [`>${plasmid.name}`];
    for (let i = 0; i < plasmid.sequence.length; i += FASTA_LINE) {
        lines.push(plasmid.sequence.slice(i, i + FASTA_LINE));
    }
    return lines.join("\n") + "\n";
}

const MONTHS = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** GenBank's DD-MMM-YYYY. */
function locusDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    return `${day}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

/**
 * A feature's GenBank location. Our coordinates are already 1-based inclusive, which is
 * exactly what GenBank uses, so the numbers pass through untouched — the only transform is
 * wrapping a reverse-strand feature in complement().
 */
export function featureLocation(feature: Pick<Feature, "start" | "end" | "strand">): string {
    const span = `${feature.start}..${feature.end}`;
    return feature.strand === "-" ? `complement(${span})` : span;
}

// GenBank wraps at 80 columns; qualifiers are indented 21 spaces.
const QUALIFIER_INDENT = " ".repeat(21);
const QUALIFIER_WIDTH = 58;

function qualifierLines(key: string, value: string): string[] {
    // Embedded quotes would terminate the value early and corrupt every following line.
    const text = `/${key}="${value.replace(/"/g, "''")}"`;
    const out: string[] = [];

    for (let i = 0; i < text.length; i += QUALIFIER_WIDTH) {
        out.push(QUALIFIER_INDENT + text.slice(i, i + QUALIFIER_WIDTH));
    }
    return out;
}

/** The ORIGIN block: a right-aligned start position, then six groups of ten bases. */
export function originBlock(sequence: string): string[] {
    const lines: string[] = [];

    for (let i = 0; i < sequence.length; i += 60) {
        const chunk = sequence.slice(i, i + 60).toLowerCase();
        const groups: string[] = [];
        for (let j = 0; j < chunk.length; j += 10) groups.push(chunk.slice(j, j + 10));
        lines.push(`${String(i + 1).padStart(9)} ${groups.join(" ")}`);
    }

    return lines;
}

export interface GenBankOptions {
    /** Injected so output is reproducible in tests. */
    date?: Date;
}

export function toGenBank(plasmid: Plasmid, { date = new Date() }: GenBankOptions = {}): string {
    // GenBank locus names cannot contain whitespace.
    const locusName = (plasmid.name || "Untitled").replace(/\s+/g, "_");
    const topology = plasmid.topology === "circular" ? "circular" : "linear";

    const lines: string[] = [
        `LOCUS       ${locusName.padEnd(16)} ${plasmid.length} bp    DNA     ${topology} SYN ${locusDate(date)}`,
        `DEFINITION  ${plasmid.name || "."}`,
        "ACCESSION   .",
        "VERSION     .",
        "KEYWORDS    .",
        "FEATURES             Location/Qualifiers",
    ];

    for (const feature of plasmid.features) {
        // The verbatim source type is what round-trips; `type` is our five-bucket collapse
        // for glyph shape and would lose information (rep_origin -> misc) if written out.
        const key = (feature.rawType || feature.type || "misc_feature").replace(/\s+/g, "_");
        lines.push(`     ${key.padEnd(15)} ${featureLocation(feature)}`);
        lines.push(...qualifierLines("label", feature.name));
        if (feature.description) lines.push(...qualifierLines("note", feature.description));
    }

    lines.push("ORIGIN", ...originBlock(plasmid.sequence), "//");
    return lines.join("\n") + "\n";
}
