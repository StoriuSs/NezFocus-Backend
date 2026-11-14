import type { Presence, SocketPresence } from '@/modules/realtime/domain'

/** One person's presence as kept: their sockets, when last heard from, what others see. */
export interface KeptPresence {
    /** Socket id → its tab's state. */
    sockets: Map<string, SocketPresence>
    /** When any of their tabs was last heard from, or the last one closed, in ms; 0 if never. */
    lastSeenAt: number
    /** What others see now; offline when not kept. */
    shown: Presence
}

/**
 * Presence Store Port — every connected person's tabs and what others see of
 * them (ARCHITECTURE 3.3, D-174), shared by every app instance. What to
 * show is decided by presence.rules.ts; this only keeps it.
 *
 * Every method throws when the store cannot be reached; the callers decide
 * what that means (a signal is dropped, a reading shows nobody online).
 */
export interface PresenceStorePort {
    /**
     * Takes the person's lock (D-174): every change to them is made holding it.
     * @returns the way to let it go, or null while someone else holds it (it
     * goes by itself after a few seconds, should its holder die)
     */
    lock(userId: string): Promise<(() => Promise<void>) | null>

    /**
     * A socket heard from at `at`: added if new (in use), its `idle` changed
     * when given, and the person's last heard from moved.
     * @returns the socket as it was, or undefined when new to the store
     */
    touch(userId: string, socketId: string, at: number, idle?: boolean): Promise<SocketPresence | undefined>

    /** A socket closed at `at`: removed; the person's last heard from moves to `at`, the 60 seconds start there. */
    remove(userId: string, socketId: string, at: number): Promise<void>

    read(userId: string): Promise<KeptPresence>

    /**
     * Keeps what others now see of the person (offline: not among those
     * shown), and drops the sockets found dead. `forget`: no tab is left,
     * nothing of them is kept any more.
     */
    show(userId: string, shown: Presence, change: { deadSocketIds: string[]; forget: boolean }): Promise<void>

    /** The people last heard from before `before` (ms): every tab closed or silent. */
    silentSince(before: number): Promise<string[]>
}

export const PRESENCE_STORE = Symbol('PresenceStorePort')
