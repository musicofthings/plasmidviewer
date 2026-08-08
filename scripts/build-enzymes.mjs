// Regenerates src/data/enzymes.json from REBASE.
//
//   node scripts/build-enzymes.mjs
//
// REBASE ships several files; we use the EMBOSS pair:
//   link_emboss_e  name / pattern / len / ncuts / blunt / c1..c4
//   link_emboss_r  per-enzyme record: name, organism, isoschizomers, methylation,
//                  source, supplier codes, references  (fields are positional, '//'-delimited)
//   link_emboss_s  supplier code -> company name
//
// Only enzymes with a KNOWN cut position (ncuts >= 2) are emitted. REBASE lists ~350 further
// putative enzymes whose recognition site is predicted but whose cut position is unknown;
// including them would let the UI draw cut marks that do not correspond to a real cut.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://rebase.neb.com/rebase";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/enzymes.json");

async function fetchText(name) {
    const response = await fetch(`${BASE}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
}

const stripComments = text => text.split("\n").filter(l => !l.startsWith("#"));

function parseSuppliers(text) {
    const suppliers = {};
    for (const line of stripComments(text)) {
        const match = /^(\S)\s+(.+?)\s*$/.exec(line);
        if (match) suppliers[match[1]] = match[2];
    }
    return suppliers;
}

/** name -> { isoschizomers, methylation, suppliers } */
function parseDetails(text) {
    const details = {};

    for (const record of text.split("//\n")) {
        const lines = record.split("\n").filter(l => !l.startsWith("#"));
        while (lines.length && lines[0].trim() === "") lines.shift();
        if (lines.length < 6) continue;

        const [name, , isoschizomers, methylation, , suppliers] = lines;
        details[name.trim()] = {
            isoschizomers: isoschizomers.trim(),
            methylation: methylation.trim(),
            suppliers: suppliers.trim(),
        };
    }

    return details;
}

function parseEnzymes(text, details) {
    const enzymes = [];

    for (const line of stripComments(text)) {
        const parts = line.split("\t");
        if (parts.length < 9) continue;

        const [name, pattern, , ncutsRaw, bluntRaw, c1Raw, c2Raw, c3Raw, c4Raw] = parts;
        const ncuts = Number(ncutsRaw);
        if (ncuts < 2) continue; // cut position unknown

        const cutTop = Number(c1Raw);
        const cutBottom = Number(c2Raw);
        const extra = details[name] ?? {};

        const enzyme = {
            name,
            site: pattern.toUpperCase(),
            cutTop,
            cutBottom,
            blunt: bluntRaw === "1",
        };

        // 27 enzymes cut on both sides of their recognition site; the second pair is c3/c4.
        if (ncuts === 4) {
            enzyme.cutTop2 = Number(c3Raw);
            enzyme.cutBottom2 = Number(c4Raw);
        }
        if (extra.suppliers) enzyme.suppliers = extra.suppliers;
        // REBASE records the cognate methyltransferase's target, e.g. "5(6)" = base 5 is
        // N6-methyladenine. That is not a full sensitivity table, so it is named accordingly.
        if (extra.methylation) enzyme.cognateMethylation = extra.methylation;
        if (extra.isoschizomers) enzyme.isoschizomers = extra.isoschizomers.split(",").map(s => s.trim());

        enzymes.push(enzyme);
    }

    return enzymes.sort((a, b) => a.name.localeCompare(b.name));
}

const [enzymeText, detailText, supplierText] = await Promise.all([
    fetchText("link_emboss_e"),
    fetchText("link_emboss_r"),
    fetchText("link_emboss_s"),
]);

const version = /REBASE version (\S+)/.exec(enzymeText)?.[1] ?? "unknown";
const suppliers = parseSuppliers(supplierText);
const enzymes = parseEnzymes(enzymeText, parseDetails(detailText));

const payload = {
    source: "REBASE, The Restriction Enzyme Database — http://rebase.neb.com",
    citation: "Roberts, R.J., Vincze, T., Posfai, J., Macelis, D. "
        + "REBASE: a database for DNA restriction and modification. Nucleic Acids Research.",
    copyright: "Copyright (c) Dr. Richard J. Roberts. All rights reserved.",
    version,
    suppliers,
    enzymes,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 0) + "\n");

console.log(`REBASE version ${version}`);
console.log(`${enzymes.length} enzymes with known cut sites`);
console.log(`${Object.keys(suppliers).length} suppliers`);
console.log(`wrote ${OUT}`);
