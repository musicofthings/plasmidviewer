import type { Track } from "../state/viewerState";
import { withStore, SESSION_STORE } from "./db";

const SESSION_KEY = "current";

export interface PersistedSession {
    tracks: Track[];
    viewMode: "linear" | "circular";
    /** The library sequence currently open in the viewer, if any. */
    openSequenceId?: string;
}

// Sequences can be hundreds of kilobases, which is why this is IndexedDB and not
// localStorage (5 MB string cap, and synchronous on the main thread).
export async function saveSession(session: PersistedSession): Promise<void> {
    await withStore(SESSION_STORE, "readwrite", store => store.put(session, SESSION_KEY));
}

export async function loadSession(): Promise<PersistedSession | null> {
    const session = await withStore<PersistedSession | undefined>(
        SESSION_STORE, "readonly", store => store.get(SESSION_KEY),
    );

    // A session written by an older build may not match the current Track shape, and a
    // half-restored session is worse than none.
    if (!session || !Array.isArray(session.tracks) || session.tracks.length === 0) return null;
    if (!session.tracks.every(isValidTrack)) return null;

    return session;
}

export async function clearSession(): Promise<void> {
    await withStore(SESSION_STORE, "readwrite", store => store.delete(SESSION_KEY));
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
