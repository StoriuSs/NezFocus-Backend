import { Presence, PresencePort } from '@/modules/realtime'
import { UserDirectoryPort } from '@/modules/users'
import { ShownPerson } from '@/shared/domain'
import { Activity, RelationshipEntry, RelationshipType } from '../../domain'
import type { StudyActivities } from './activities'

/** A person as others see them, the picture as an address; nulls for an account deleted or waiting to be (D-182). */
export interface PersonView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** One person in my list, or the answer to a change (D-237): where we stand, and their presence when we are friends. */
export interface RelationshipView {
    user: PersonView
    type: RelationshipType
    /** Their request's note, to me only. */
    note: string | null
    since: Date | null
    /** What I see of them, for a friend (D-242: presence goes to friends); null for anyone else. */
    presence: Presence | null
    /** What they study now, where their presence is given (D-240, D-247); null when they show nothing. */
    activity: Activity | null
}

/** Every presence a view may give, as realtime shows it (REQ-AUTH-07), for the API's list of values. */
export const SHOWN_PRESENCES: readonly Presence[] = ['online', 'idle', 'dnd', 'offline']

/** What views read: pictures, presence, study activity. */
export interface ViewSources {
    users: UserDirectoryPort
    presence: PresencePort
    activities: StudyActivities
}

/** The picture's address, or none when it cannot be signed: a list never fails for a picture. */
async function addressOf(users: UserDirectoryPort, key: string): Promise<string | null> {
    try {
        return await users.avatarUrl(key)
    } catch {
        return null
    }
}

/** These people with their pictures as addresses, each picture signed once. */
export async function personViews(users: UserDirectoryPort, people: ShownPerson[]): Promise<PersonView[]> {
    const keys = [...new Set(people.map((person) => person.avatarUrl).filter((key): key is string => !!key))]
    const urls = new Map(await Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)))
    return people.map((person) => ({
        ...person,
        avatarUrl: person.avatarUrl ? (urls.get(person.avatarUrl) ?? null) : null
    }))
}

/**
 * The entries as views, in the order given: presence and activity read
 * once, and only when one of them is a friend (offline when they are not
 * shown, D-182 or invisible).
 */
export async function relationshipViews(
    { users, presence, activities }: ViewSources,
    entries: RelationshipEntry[]
): Promise<RelationshipView[]> {
    const friendIds = entries.filter((entry) => entry.type === 'friend').map((entry) => entry.person.id)
    const [shown, studying, people] = await Promise.all([
        friendIds.length > 0 ? presence.everyoneShown() : new Map<string, Presence>(),
        activities.of(friendIds),
        personViews(
            users,
            entries.map((entry) => entry.person)
        )
    ])
    return entries.map(({ type, note, since }, index) => ({
        user: people[index]!,
        type,
        note,
        since,
        presence: type === 'friend' ? (shown.get(people[index]!.id) ?? 'offline') : null,
        activity: type === 'friend' ? (studying.get(people[index]!.id) ?? null) : null
    }))
}
