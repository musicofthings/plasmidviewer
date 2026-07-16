export type Strand = "+" | "-";

export interface Feature {
  id: string;
  name: string;
  type: "CDS" | "promoter" | "terminator" | "marker" | "misc";
  start: number; // 1-based inclusive
  end: number;
  strand: Strand;
}

export type Topology = "circular" | "linear";

export interface Plasmid {
  name: string;
  length: number;
  sequence: string;
  features: Feature[];
  // What the source file declared. FASTA carries no topology, so it defaults to "linear";
  // GenBank/SnapGene set it from the record (FR-5).
  topology: Topology;
}
