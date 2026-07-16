import type { LibraryNode, SequenceRecord, NodeLevel } from "../models/library";
import { CHILD_LEVEL, LEVEL_ORDER } from "../models/library";

// The whole hierarchy held in memory. Small enough for a single user that loading it all and
// deriving views with the pure helpers below is simpler than incremental querying.
export interface LibraryData {
    workspaces: LibraryNode[];
    projects: LibraryNode[];
    experiments: LibraryNode[];
    samples: LibraryNode[];
    sequences: SequenceRecord[];
}

export const EMPTY_LIBRARY: LibraryData = {
    workspaces: [], projects: [], experiments: [], samples: [], sequences: [],
};

export function nodesAtLevel(data: LibraryData, level: NodeLevel): LibraryNode[] {
    switch (level) {
        case "workspace": return data.workspaces;
        case "project": return data.projects;
        case "experiment": return data.experiments;
        case "sample": return data.samples;
        case "sequence": return data.sequences;
    }
}

/** Children of `parentId` at the level contained by `level`, name-sorted. Empty for a leaf. */
export function childrenOf(data: LibraryData, level: NodeLevel, parentId: string): LibraryNode[] {
    const childLevel = CHILD_LEVEL[level];
    if (!childLevel) return [];
    return nodesAtLevel(data, childLevel)
        .filter(n => n.parentId === parentId)
        .sort(byName);
}

export function byName(a: LibraryNode, b: LibraryNode): number {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

/** Every descendant id of a node (all levels below it), for cascade delete. */
export function descendantIds(data: LibraryData, level: NodeLevel, id: string): string[] {
    const out: string[] = [];
    const walk = (lvl: NodeLevel, parentId: string) => {
        const childLevel = CHILD_LEVEL[lvl];
        if (!childLevel) return;
        for (const child of nodesAtLevel(data, childLevel).filter(n => n.parentId === parentId)) {
            out.push(child.id);
            walk(childLevel, child.id);
        }
    };
    walk(level, id);
    return out;
}

/** A node's ancestor chain from the root down to (and including) the node, for breadcrumbs. */
export function nodePath(
    data: LibraryData, level: NodeLevel, id: string,
): { level: NodeLevel; node: LibraryNode }[] {
    const levelIndex = LEVEL_ORDER.indexOf(level);
    const chain: { level: NodeLevel; node: LibraryNode }[] = [];

    let currentLevel: NodeLevel | undefined = level;
    let currentId: string | null = id;
    for (let i = levelIndex; i >= 0 && currentLevel && currentId; i--) {
        const node: LibraryNode | undefined = nodesAtLevel(data, currentLevel).find(n => n.id === currentId);
        if (!node) break;
        chain.unshift({ level: currentLevel, node });
        currentId = node.parentId;
        currentLevel = LEVEL_ORDER[i - 1];
    }
    return chain;
}

/** Next default name for a new child, avoiding collisions like "Sample", "Sample 2", … */
export function defaultChildName(existing: LibraryNode[], baseLabel: string): string {
    const taken = new Set(existing.map(n => n.name));
    if (!taken.has(baseLabel)) return baseLabel;
    for (let i = 2; ; i++) {
        const candidate = `${baseLabel} ${i}`;
        if (!taken.has(candidate)) return candidate;
    }
}
