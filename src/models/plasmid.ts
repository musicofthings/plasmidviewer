export type Strand = "+" | "-";

export type FeatureType = "CDS" | "promoter" | "terminator" | "marker" | "misc";

export interface Feature {
  id: string;
  name: string;
  type: FeatureType;
  start: number; // 1-based inclusive
  end: number;
  strand: Strand;
  // The verbatim type from the source file (e.g. "rep_origin", "LTR", "primer_bind"),
  // kept for display since `type` collapses everything into five buckets.
  rawType?: string;
  // Free text from /note, /product, /function or /gene qualifiers, shown on hover.
  description?: string;
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
