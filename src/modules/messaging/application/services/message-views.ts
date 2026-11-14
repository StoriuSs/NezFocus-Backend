import { UserDirectoryPort } from '@/modules/users'
import { MessageAuthor, MessageRecord, ReactionSummary, RepliedMessage } from '../../domain'

/** Who wrote a message, the picture as an address. */
export interface MessageAuthorView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** The message a reply answers, as its reply line shows it. */
export interface RepliedMessageView extends Omit<RepliedMessage, 'author'> {
    author: MessageAuthorView | null
}

/** A message as the API and the socket give it. */
export interface MessageView extends Omit<MessageRecord, 'author' | 'replyTo' | 'systemUser'> {
    author: MessageAuthorView | null
    replyTo: RepliedMessageView | null
    systemUser: MessageAuthorView | null
}

/**
 * A message as one person reads it in history or the pins: with its
 * reactions, which say whether the reader gave each. Events never carry
 * them (each reader's `me` differs): `reaction.*` events change them.
 */
export interface ReadMessageView extends MessageView {
    reactions: ReactionSummary[]
}

/** The views with each message's reactions as `summaries` has them, none for the others. */
export const withReactions = (views: MessageView[], summaries: Map<string, ReactionSummary[]>): ReadMessageView[] =>
    views.map((view) => ({ ...view, reactions: summaries.get(view.id) ?? [] }))

/** The picture's address, or none when it cannot be signed: a message never fails for a picture. */
async function addressOf(users: UserDirectoryPort, key: string): Promise<string | null> {
    try {
        return await users.avatarUrl(key)
    } catch {
        return null
    }
}

/**
 * The records with each author's picture turned into an address, the
 * authors of the messages they answer and the people system messages are
 * about included. One signature per picture,
 * however many messages share it: a page of 50 from one conversation signs
 * two or three.
 */
export async function messageViews(users: UserDirectoryPort, records: MessageRecord[]): Promise<MessageView[]> {
    const authors = records.flatMap((record) => [record.author, record.replyTo?.author ?? null, record.systemUser])
    const keys = [...new Set(authors.map((author) => author?.avatarKey).filter((key) => !!key))] as string[]
    const urls = new Map(await Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)))
    const view = (author: MessageAuthor | null): MessageAuthorView | null =>
        author && {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            avatarUrl: author.avatarKey ? (urls.get(author.avatarKey) ?? null) : null
        }

    return records.map(({ author, replyTo, systemUser, ...message }) => ({
        ...message,
        author: view(author),
        replyTo: replyTo && { ...replyTo, author: view(replyTo.author) },
        systemUser: view(systemUser)
    }))
}
