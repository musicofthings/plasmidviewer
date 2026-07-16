import type { Plasmid } from "../models/plasmid";

export function parseFasta(text: string): Plasmid {
    const lines = text.split(/\r?\n/);
    let name = "Untitled";
    let sequence = "";
    let headerFound = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (trimmed.startsWith(">")) {
            if (!headerFound) {
                // Clean header: remove > and take first word or full line?
                // Usually first word is ID, rest is description.
                // Let's take the whole line for now but remove >
                name = trimmed.slice(1).trim();
                headerFound = true;
            }
            // Ignore subsequent headers if multiple records?
            // For now, simpler to just parse the first one implied by the user request "Upload Plasmid".
        } else {
            // Robust cleanup: allow only A-Z, a-z. Ignore numbers, spaces, asterisks from alignment files.
            // Sometimes FASTA has '*' for stop codon or '-' for gaps.
            // If we want "Plasmid Viewer", gaps might be weird unless it's alignment.
            // But let's allow basic cleanup.
            sequence += trimmed.replace(/[^a-zA-Z]/g, "");
        }
    }

    return {
        name,
        length: sequence.length,
        sequence: sequence.toUpperCase(),
        features: [],
        // FASTA declares no topology; linear is the honest default (FR-5).
        topology: "linear",
    };
}
