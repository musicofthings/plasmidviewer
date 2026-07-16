// Single IndexedDB database shared by the transient viewer session (persistence.ts) and the
// library hierarchy (library.ts). Both must agree on DB_VERSION, so the schema for every store
// is created here in one place.

const DB_NAME = "plasmidviewer";
const DB_VERSION = 2;

export const SESSION_STORE = "session";

// One store per library level; each keyed by `id` with an index on `parentId` so children can
// be fetched without scanning.
const ENTITY_STORES = ["workspaces", "projects", "experiments", "samples", "sequences"];

export function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            // v1 store: out-of-line keys (the session is stored under a fixed key).
            if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);

            for (const name of ENTITY_STORES) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: "id" });
                    store.createIndex("parentId", "parentId", { unique: false });
                }
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Failed to open database"));
    });
}

export function withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(db => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = run(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Storage request failed"));
        tx.oncomplete = () => db.close();
    }));
}
