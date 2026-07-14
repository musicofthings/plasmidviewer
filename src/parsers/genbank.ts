import { genbankToJson } from "@teselagen/bio-parsers";
import type { Plasmid } from "../models/plasmid";
import { plasmidFromTeselagen, type TeselagenSequence } from "./teselagen";

export async function parseGenBank(file: File): Promise<Plasmid> {
    const text = await file.text();
    const result = await genbankToJson(text);

    if (!result || result.length === 0) {
        throw new Error("Failed to parse GenBank file");
    }

    // Multi-record GenBank is FR-4 (P2); take the first record for now.
    const parsed = result[0].parsedSequence as TeselagenSequence;

    if (!parsed?.sequence) {
        throw new Error("GenBank file contains no sequence");
    }

    return plasmidFromTeselagen(parsed, file.name);
}
