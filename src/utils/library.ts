import type { Plasmid } from "../models/plasmid";
import type { LibraryNode, SequenceRecord, NodeLevel } from "../models/library";
import { STORE_NAME, CHILD_LEVEL } from "../models/library";
import { withStore } from "./db";
import type { LibraryData } from "./libraryTree";

function newId(): string {
    return crypto.randomUUID();
}

async function listAll<T extends LibraryNode>(level: NodeLevel): Promise<T[]> {
    return withStore<T[]>(STORE_NAME[level], "readonly", store => store.getAll());
}

/** Loads the entire hierarchy into memory (see LibraryData). */
export async function loadLibrary(): Promise<LibraryData> {
    const [workspaces, projects, experiments, samples, sequences] = await Promise.all([
        listAll("workspace"),
        listAll("project"),
        listAll("experiment"),
        listAll("sample"),
        listAll<SequenceRecord>("sequence"),
    ]);
    return { workspaces, projects, experiments, samples, sequences };
}

export async function createNode(
    level: NodeLevel, parentId: string | null, name: string,
): Promise<LibraryNode> {
    const stamp = Date.now();
    const node: LibraryNode = { id: newId(), name, parentId, createdAt: stamp, updatedAt: stamp };
    await withStore(STORE_NAME[level], "readwrite", store => store.put(node));
    return node;
}

export async function createSequence(
    sampleId: string, name: string, plasmid: Plasmid, sourceName?: string,
): Promise<SequenceRecord> {
    const stamp = Date.now();
    const node: SequenceRecord = {
        id: newId(), name, parentId: sampleId, plasmid, sourceName, createdAt: stamp, updatedAt: stamp,
    };
    await withStore(STORE_NAME.sequence, "readwrite", store => store.put(node));
    return node;
}

export async function renameNode(level: NodeLevel, node: LibraryNode, name: string): Promise<LibraryNode> {
    const updated = { ...node, name, updatedAt: Date.now() };
    await withStore(STORE_NAME[level], "readwrite", store => store.put(updated));
    return updated;
}

/** Deletes a node and everything under it. Descendants go first so nothing is orphaned. */
export async function deleteNode(level: NodeLevel, id: string): Promise<void> {
    const childLevel = CHILD_LEVEL[level];
    if (childLevel) {
        const children = await withStore<LibraryNode[]>(
            STORE_NAME[childLevel], "readonly", store => store.index("parentId").getAll(id),
        );
        for (const child of children) await deleteNode(childLevel, child.id);
    }
    await withStore(STORE_NAME[level], "readwrite", store => store.delete(id));
}
