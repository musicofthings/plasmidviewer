import { snapgeneToJson } from "@teselagen/bio-parsers";
import type { Plasmid } from "../models/plasmid";
import { plasmidFromTeselagen, type TeselagenSequence } from "./teselagen";

export async function parseSnapGene(file: File): Promise<Plasmid> {
    const results = await snapgeneToJson(file);

    if (!results || results.length === 0) {
        throw new Error("Failed to parse SnapGene file");
    }

    const parsed = results[0].parsedSequence as TeselagenSequence;

    if (!parsed?.sequence) {
        throw new Error("SnapGene file contains no sequence");
    }

    return plasmidFromTeselagen(parsed, file.name);
}
