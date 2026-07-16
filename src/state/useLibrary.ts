import { useCallback, useEffect, useState } from "react";
import type { Plasmid } from "../models/plasmid";
import type { NodeLevel, LibraryNode, SequenceRecord } from "../models/library";
import { loadLibrary, createNode, createSequence, renameNode, deleteNode } from "../utils/library";
import { EMPTY_LIBRARY, type LibraryData } from "../utils/libraryTree";

export interface Library {
    data: LibraryData;
    loaded: boolean;
    create: (level: NodeLevel, parentId: string | null, name: string) => Promise<LibraryNode>;
    saveSequence: (sampleId: string, name: string, plasmid: Plasmid, sourceName?: string) => Promise<SequenceRecord>;
    rename: (level: NodeLevel, node: LibraryNode, name: string) => Promise<void>;
    remove: (level: NodeLevel, id: string) => Promise<void>;
}

// Loads the whole hierarchy once, then re-reads it from IndexedDB after each mutation. The
// dataset is a single user's library, so a full reload is cheaper to reason about than
// surgically patching five arrays and always stays consistent with what is on disk.
export function useLibrary(): Library {
    const [data, setData] = useState<LibraryData>(EMPTY_LIBRARY);
    const [loaded, setLoaded] = useState(false);

    const reload = useCallback(async () => {
        setData(await loadLibrary());
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadLibrary()
            .then(next => { if (!cancelled) setData(next); })
            .catch(() => { /* an unreadable library just opens empty */ })
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, []);

    const create = useCallback(async (level: NodeLevel, parentId: string | null, name: string) => {
        const node = await createNode(level, parentId, name);
        await reload();
        return node;
    }, [reload]);

    const saveSequence = useCallback(async (
        sampleId: string, name: string, plasmid: Plasmid, sourceName?: string,
    ) => {
        const node = await createSequence(sampleId, name, plasmid, sourceName);
        await reload();
        return node;
    }, [reload]);

    const rename = useCallback(async (level: NodeLevel, node: LibraryNode, name: string) => {
        await renameNode(level, node, name);
        await reload();
    }, [reload]);

    const remove = useCallback(async (level: NodeLevel, id: string) => {
        await deleteNode(level, id);
        await reload();
    }, [reload]);

    return { data, loaded, create, saveSequence, rename, remove };
}
