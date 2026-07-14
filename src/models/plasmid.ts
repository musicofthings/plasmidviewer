export type Strand = "+" | "-";

export interface Feature {
  id: string;
  name: string;
  type: "CDS" | "promoter" | "terminator" | "marker" | "misc";
  start: number; // 1-based inclusive
  end: number;
  strand: Strand;
}

export interface Plasmid {
  name: string;
  length: number;
  sequence: string;
  features: Feature[];
}
