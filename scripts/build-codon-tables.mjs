// Regenerates src/data/codonTables.json from the Kazusa Codon Usage Database (CUTG).
//
//   node scripts/build-codon-tables.mjs
//
// Kazusa serves one table per NCBI taxonomy id from a CGI in several formats. We ask for the
// GCG style, which is the only one that gives raw per-codon *counts*:
//
//   AmAcid  Codon      Number    /1000     Fraction
//   Gly     GGG     15115.00     11.02      0.00
//
// The Fraction column is reported as 0.00 in this style, so relative synonymous frequencies are
// recomputed here from the counts. That is the more defensible route regardless: it makes the
// arithmetic ours and lets the sanity checks below fail loudly on a malformed fetch.
//
// Only the hosts in HOSTS are emitted — the database covers ~35,000 organisms, and a codon
// optimiser is only ever pointed at an expression host. Each entry carries the CDS count the
// table was built from, because three of these rest on very few genes and the UI says so.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CGI = "https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/codonTables.json");

// Expression hosts, in the order the picker shows them: the two workhorse bacteria, then yeast,
// then mammalian, then insect and plant.
const HOSTS = [
    { id: "e_coli", taxid: 316407, name: "E. coli K-12", note: "W3110; the standard cloning and expression strain" },
    { id: "b_subtilis", taxid: 1423, name: "B. subtilis", note: "Secreted protein expression" },
    { id: "s_cerevisiae", taxid: 4932, name: "S. cerevisiae", note: "Baker's yeast" },
    { id: "p_pastoris", taxid: 4922, name: "P. pastoris", note: "Komagataella phaffii; methylotrophic yeast" },
    { id: "h_sapiens", taxid: 9606, name: "H. sapiens", note: "HEK293 and other human cell lines" },
    { id: "cho", taxid: 10029, name: "CHO (C. griseus)", note: "Chinese hamster ovary; biologics manufacturing" },
    { id: "m_musculus", taxid: 10090, name: "M. musculus", note: "Mouse cell lines" },
    { id: "sf9", taxid: 7108, name: "Sf9 (S. frugiperda)", note: "Baculovirus insect expression" },
    { id: "d_melanogaster", taxid: 7227, name: "D. melanogaster", note: "S2 cells" },
    { id: "n_tabacum", taxid: 4097, name: "N. tabacum", note: "Plant transient expression" },
    { id: "a_thaliana", taxid: 3702, name: "A. thaliana", note: "Plant model system" },
];

const THREE_TO_ONE = {
    Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G",
    His: "H", Ile: "I", Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S",
    Thr: "T", Trp: "W", Tyr: "Y", Val: "V", End: "*", Ter: "*", Stop: "*",
};

// NCBI translation table 1, duplicated from src/utils/sequence.ts on purpose: this script runs
// outside the bundle, and the duplication is what lets it *verify* that Kazusa's amino-acid
// assignment agrees with the genetic code the app translates with.
const CODONS = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

async function fetchHost({ taxid }) {
    const response = await fetch(`${CGI}?species=${taxid}&aa=1&style=GCG`);
    if (!response.ok) throw new Error(`taxid ${taxid}: HTTP ${response.status}`);
    return response.text();
}

/** The italicised header line, e.g. "Escherichia coli W3110 [gbbct]: 4332 CDS's (1372057 codons)". */
function parseHeader(html, taxid) {
    const match = html.match(/<STRONG><i>(.*?)<\/i>\s*\[(\w+)\]:\s*([\d,]+)\s*CDS/);
    if (!match) throw new Error(`taxid ${taxid}: could not read the species header`);
    return {
        source: match[1].trim(),
        division: match[2],
        cds: Number(match[3].replace(/,/g, "")),
    };
}

function parseCounts(html, taxid) {
    const body = html.match(/<PRE>([\s\S]*?)<\/PRE>/);
    if (!body) throw new Error(`taxid ${taxid}: no <PRE> block`);

    const counts = {};
    for (const line of body[1].split("\n")) {
        const match = line.match(/^\s*(\w+)\s+([ACGTU]{3})\s+([\d.]+)\s+([\d.]+)/);
        if (!match) continue;

        const [, threeLetter, rawCodon, number] = match;
        const aa = THREE_TO_ONE[threeLetter];
        if (!aa) throw new Error(`taxid ${taxid}: unknown amino acid "${threeLetter}"`);

        const codon = rawCodon.replace(/U/g, "T");
        if (CODONS[codon] !== aa) {
            throw new Error(
                `taxid ${taxid}: ${codon} is ${CODONS[codon]} in translation table 1 but Kazusa says ${aa}`);
        }
        counts[codon] = Number(number);
    }

    const missing = Object.keys(CODONS).filter(c => !(c in counts));
    if (missing.length > 0) throw new Error(`taxid ${taxid}: missing ${missing.join(", ")}`);

    return counts;
}

/**
 * Relative synonymous frequency plus occurrences per thousand codons.
 *
 * The frequency is within the amino acid's own synonymous family — the number a codon optimiser
 * actually chooses on — so Met and Trp are 1, and each family sums to 1.
 */
function toTable(counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    const familyTotals = {};
    for (const [codon, n] of Object.entries(counts)) {
        const aa = CODONS[codon];
        familyTotals[aa] = (familyTotals[aa] ?? 0) + n;
    }

    const table = {};
    for (const [codon, n] of Object.entries(counts)) {
        const family = familyTotals[CODONS[codon]];
        table[codon] = {
            // Rounded to 4 dp: the underlying counts do not justify more, and it keeps the
            // committed JSON diffable.
            fraction: family === 0 ? 0 : Number((n / family).toFixed(4)),
            perThousand: Number(((n / total) * 1000).toFixed(2)),
        };
    }

    // A family that sums to something other than 1 means a codon was dropped or double counted.
    for (const [aa, familyTotal] of Object.entries(familyTotals)) {
        if (familyTotal === 0) continue;
        const sum = Object.entries(table)
            .filter(([codon]) => CODONS[codon] === aa)
            .reduce((acc, [, v]) => acc + v.fraction, 0);
        if (Math.abs(sum - 1) > 0.005) {
            throw new Error(`${aa}: synonymous fractions sum to ${sum.toFixed(4)}, not 1`);
        }
    }

    return { table, totalCodons: total };
}

const hosts = [];
for (const host of HOSTS) {
    const html = await fetchHost(host);
    const header = parseHeader(html, host.taxid);
    const { table, totalCodons } = toTable(parseCounts(html, host.taxid));

    hosts.push({
        id: host.id,
        name: host.name,
        note: host.note,
        taxid: host.taxid,
        source: header.source,
        cdsCount: header.cds,
        codonCount: totalCodons,
        codons: table,
    });

    console.log(`${host.name.padEnd(18)} taxid ${String(host.taxid).padEnd(7)} `
        + `${String(header.cds).padStart(6)} CDS  ${totalCodons.toLocaleString()} codons`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
    retrieved: new Date().toISOString().slice(0, 10),
    source: "Kazusa Codon Usage Database (CUTG), Nakamura et al. NAR 2000;28:292",
    url: CGI,
    hosts,
}, null, 2) + "\n");

console.log(`\nWrote ${hosts.length} hosts to ${OUT}`);
