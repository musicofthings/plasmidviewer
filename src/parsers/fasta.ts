import type { Plasmid } from "../models/plasmid";

export interface FastaRecord {
    name: string;
    sequence: string;
}

/**
 * Splits FASTA text into its records.
 *
 * Each `>` header starts a new record. Keeping them separate is the whole point: concatenating
 * a multi-record file into one sequence would silently produce a construct that does not exist,
 * and every coordinate derived from it — features, ruler, GC%, translation — would be wrong.
 */
export function parseFastaRecords(text: string): FastaRecord[] {
    const records: FastaRecord[] = [];
    let current: FastaRecord | null = null;

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (trimmed.startsWith(">")) {
            // The header is the whole description line; the leading ">" is not part of the name.
            current = { name: trimmed.slice(1).trim() || "Untitled", sequence: "" };
            records.push(current);
            continue;
        }

        // Sequence lines in the wild carry line numbers, spaces, alignment gaps and stop
        // codons. Keep the letters and drop the rest.
        const bases = trimmed.replace(/[^a-zA-Z]/g, "").toUpperCase();
        if (bases.length === 0) continue;

        // Bases before any header: a headerless FASTA is still a sequence worth reading.
        if (!current) {
            current = { name: "Untitled", sequence: "" };
            records.push(current);
        }
        current.sequence += bases;
    }

    return records;
}

export function plasmidFromFastaRecord(record: FastaRecord): Plasmid {
    return {
        name: record.name,
        length: record.sequence.length,
        sequence: record.sequence,
        features: [],
        // FASTA declares no topology; linear is the honest default (FR-5).
        topology: "linear",
    };
}

/**
 * The first record of a FASTA file as a Plasmid. Callers that need to tell the user a
 * multi-record file was truncated should use `parseFastaRecords` and check the count.
 */
export function parseFasta(text: string): Plasmid {
    const [first] = parseFastaRecords(text);
    return plasmidFromFastaRecord(first ?? { name: "Untitled", sequence: "" });
}
