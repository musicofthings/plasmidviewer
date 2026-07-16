import type { Plasmid } from "./plasmid";

// The Benchling-style containment hierarchy. Each level holds the one below it; a sequence is
// the leaf and carries the actual parsed construct that the viewer renders.
export type NodeLevel = "workspace" | "project" | "experiment" | "sample" | "sequence";

export interface LibraryNode {
    id: string;
    name: string;
    /** Parent node id; null only for a workspace (the root level). */
    parentId: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface SequenceRecord extends LibraryNode {
    parentId: string;
    plasmid: Plasmid;
    /** Original file name the sequence was imported from, if any. */
    sourceName?: string;
}

/** The level contained by each level, or null for the leaf. */
export const CHILD_LEVEL: Record<NodeLevel, NodeLevel | null> = {
    workspace: "project",
    project: "experiment",
    experiment: "sample",
    sample: "sequence",
    sequence: null,
};

export const PARENT_LEVEL: Record<NodeLevel, NodeLevel | null> = {
    workspace: null,
    project: "workspace",
    experiment: "project",
    sample: "experiment",
    sequence: "sample",
};

export const LEVEL_LABEL: Record<NodeLevel, string> = {
    workspace: "Workspace",
    project: "Project",
    experiment: "Experiment",
    sample: "Sample",
    sequence: "Sequence",
};

/** IndexedDB object store backing each level. */
export const STORE_NAME: Record<NodeLevel, string> = {
    workspace: "workspaces",
    project: "projects",
    experiment: "experiments",
    sample: "samples",
    sequence: "sequences",
};

export const LEVEL_ORDER: NodeLevel[] = ["workspace", "project", "experiment", "sample", "sequence"];
