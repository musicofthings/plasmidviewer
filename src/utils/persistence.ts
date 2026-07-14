import type { Track } from "../state/viewerState";

const DB_NAME = "plasmidviewer";
const DB_VERSION = 1;
const STORE = "session";
const SESSION_KEY = "current";

export interface PersistedSession {
    tracks: Track[];
    viewMode: "linear" | "circular";
}

// Sequences can be hundreds of kilobases, which is why this is IndexedDB and not
// localStorage (5 MB string cap, and synchronous on the main thread).
function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Failed to open database"));
    });
}

function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(db => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Storage request failed"));
        tx.oncomplete = () => db.close();
    }));
}

export async function saveSession(session: PersistedSession): Promise<void> {
    await withStore("readwrite", store => store.put(session, SESSION_KEY));
}

export async function loadSession(): Promise<PersistedSession | null> {
    const session = await withStore<PersistedSession | undefined>(
        "readonly", store => store.get(SESSION_KEY),
    );

    // A session written by an older build may not match the current Track shape, and a
    // half-restored session is worse than none.
    if (!session || !Array.isArray(session.tracks) || session.tracks.length === 0) return null;
    if (!session.tracks.every(isValidTrack)) return null;

    return session;
}

export async function clearSession(): Promise<void> {
    await withStore("readwrite", store => store.delete(SESSION_KEY));
}

function isValidTrack(track: unknown): track is Track {
    if (typeof track !== "object" || track === null) return false;
    const t = track as Partial<Track>;
    return (
        typeof t.id === "string" &&
        typeof t.offsetBp === "number" &&
        typeof t.plasmid === "object" && t.plasmid !== null &&
        typeof t.plasmid.sequence === "string" &&
        Array.isArray(t.plasmid.features)
    );
}
