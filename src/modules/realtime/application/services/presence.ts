import { Inject, Logger } from '@nestjs/common'
import { MEMBERSHIP, type MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, type UserDirectoryPort } from '@/modules/users'
import { liveSockets, shownPresence, type Presence } from '../../domain'
import {
    EVENT_PUBLISHER,
    FRIENDS,
    PRESENCE_STORE,
    type EventPublisherPort,
    type FriendsPort,
    type PresenceStorePort
} from '../ports'

/** What working out someone's presence needs. */
export interface PresenceDeps {
    store: PresenceStorePort
    publisher: EventPublisherPort
    membership: MembershipPort
    directory: UserDirectoryPort
    friends: FriendsPort
}

/** Who hears a person's presence besides their own tabs: their servers, and their friends (D-242). */
interface Audience {
    serverIds: string[]
    friendIds: string[]
}

const NOBODY: Audience = { serverIds: [], friendIds: [] }

/** Reads the person's servers and friends; throws when either cannot be read. */
async function audienceOf(deps: PresenceDeps, userId: string): Promise<Audience> {
    const [serverIds, friendIds] = await Promise.all([
        deps.membership.serverIdsOf(userId),
        deps.friends.friendIdsOf(userId)
    ])
    return { serverIds, friendIds }
}

/** How long to wait for a person's lock before going on without it: a holder that died lets go by its expiry. */
const LOCK_WAIT_MS = 1000
const LOCK_RETRY_MS = 25

/**
 * Runs `work` holding the person's presence lock (D-174): two signals of
 * theirs at once (a tab going unused while another status is chosen, the
 * sweep while a tab connects) each read and write what the other left,
 * never half of it. Waited for up to a second; past that the work goes on
 * unlocked, with a warning, rather than drop the signal.
 */
export async function underLock<T>(deps: PresenceDeps, userId: string, work: () => Promise<T>, logger: Logger) {
    const until = Date.now() + LOCK_WAIT_MS
    let release = await deps.store.lock(userId)
    while (!release && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
        release = await deps.store.lock(userId)
    }
    if (!release) logger.warn(`Presence of ${userId} changed without its lock: held too long`)
    try {
        return await work()
    } finally {
        await release?.()
    }
}

/**
 * Works out what others see of `userId` now (presence.rules.ts) from their
 * kept tabs and chosen status, keeps it, and when it changed tells it as
 * `presence.updated`: to their own tabs, to every server they are in
 * and to each of their friends (ARCHITECTURE 3.3, D-242). Tabs not heard
 * from for 60 seconds are dropped on the way. Returns what others see. Run
 * under the person's lock (`underLock`).
 *
 * The servers and friends are read before anything is kept: when they
 * cannot be, nothing changes and the next signal or sweep tries again. Throws when the store
 * cannot be reached.
 */
export async function announcePresence(deps: PresenceDeps, userId: string, now: number): Promise<Presence> {
    const kept = await deps.store.read(userId)
    const live = liveSockets([...kept.sockets.values()], now)
    const dead = [...kept.sockets].filter(([, socket]) => !live.includes(socket)).map(([id]) => id)
    // The chosen status matters only while a tab is open.
    const chosen = live.length > 0 ? await deps.directory.presenceOf(userId) : 'online'
    const shown = shownPresence({ chosen, sockets: live, held: kept.shown, lastSeenAt: kept.lastSeenAt, now })

    // Gone for good: no tab left, and offline (or invisible) once the 60 seconds are over.
    const forget = live.length === 0 && shown === 'offline' && kept.lastSeenAt > 0
    if (shown === kept.shown && dead.length === 0 && !forget) return shown
    const audience = shown === kept.shown ? NOBODY : await audienceOf(deps, userId)
    await deps.store.show(userId, shown, { deadSocketIds: dead, forget })
    if (shown !== kept.shown) tellPresence(deps, userId, shown, audience)
    return shown
}

/**
 * Tells what others now see of someone, as `presence.updated`: to their own
 * tabs, to every server they are in and to each friend (ARCHITECTURE 3.3,
 * D-242), here for every way presence changes. A friend in a server with
 * them hears it twice; the client keeps the last.
 */
function tellPresence(deps: PresenceDeps, userId: string, status: Presence, { serverIds, friendIds }: Audience): void {
    const event = { userId, status }
    deps.publisher.toUser(userId, 'presence.updated', event)
    for (const serverId of serverIds) deps.publisher.toServer(serverId, 'presence.updated', event)
    for (const friendId of friendIds) deps.publisher.toUser(friendId, 'presence.updated', event)
}

/**
 * Someone who can have no tab any more (their account waits to be deleted,
 * every session ended): offline now, rather than after the 60 seconds a
 * closed tab is held for, and nothing of them kept (D-182: others see the
 * account as deleted, not as someone here a moment ago). Told to their
 * servers and friends when they showed as anything else. A socket of theirs closing
 * later finds them offline already and tells nothing. Run under the
 * person's lock (`underLock`).
 */
export async function announceGone(deps: PresenceDeps, userId: string): Promise<void> {
    const kept = await deps.store.read(userId)
    if (kept.shown === 'offline' && kept.sockets.size === 0 && kept.lastSeenAt === 0) return
    const audience = kept.shown === 'offline' ? NOBODY : await audienceOf(deps, userId)
    await deps.store.show(userId, 'offline', { deadSocketIds: [...kept.sockets.keys()], forget: true })
    if (kept.shown !== 'offline') tellPresence(deps, userId, 'offline', audience)
}

/**
 * What every presence handler shares: its ports, the lock, and dropping a
 * signal with a warning while the store cannot be reached (presence is not
 * worth cutting a socket off for; the next signal after Redis is back puts
 * it right).
 */
export abstract class PresenceHandler {
    protected readonly logger = new Logger(this.constructor.name)
    protected readonly deps: PresenceDeps

    constructor(
        @Inject(PRESENCE_STORE) store: PresenceStorePort,
        @Inject(EVENT_PUBLISHER) publisher: EventPublisherPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(USER_DIRECTORY) directory: UserDirectoryPort,
        @Inject(FRIENDS) friends: FriendsPort
    ) {
        this.deps = { store, publisher, membership, directory, friends }
    }

    /** `work` under the person's lock; on a failure, `fallback`. */
    protected async changing<T>(userId: string, work: () => Promise<T>, fallback: T): Promise<T> {
        try {
            return await underLock(this.deps, userId, work, this.logger)
        } catch (error) {
            this.logger.warn(`Presence not kept: ${(error as Error)?.message}`)
            return fallback
        }
    }
}
