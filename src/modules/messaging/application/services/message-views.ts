import { UserDirectoryPort } from '@/modules/users'
import { MessageRecord } from '../../domain'

/** Who wrote a message, the picture as an address. */
export interface MessageAuthorView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** A message as the API and the socket give it. */
export interface MessageView extends Omit<MessageRecord, 'author'> {
    author: MessageAuthorView | null
}

/** The picture's address, or none when it cannot be signed: a message never fails for a picture. */
async function addressOf(users: UserDirectoryPort, key: string): Promise<string | null> {
    try {
        return await users.avatarUrl(key)
    } catch {
        return null
    }
}

/**
 * The records with each author's picture turned into an address. One
 * signature per picture, however many messages share it: a page of 50 from
 * one conversation signs two or three.
 */
export async function messageViews(users: UserDirectoryPort, records: MessageRecord[]): Promise<MessageView[]> {
    const keys = [...new Set(records.map((record) => record.author?.avatarKey).filter((key) => !!key))] as string[]
    const urls = new Map(await Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)))

    return records.map(({ author, ...message }) => ({
        ...message,
        author: author && {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            avatarUrl: author.avatarKey ? (urls.get(author.avatarKey) ?? null) : null
        }
    }))
}
