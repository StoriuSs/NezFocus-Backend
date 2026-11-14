import { RoleDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { MessageAuthor, MessageRecord, ReactionSummary, RepliedMessage } from '../../domain'

/** Who wrote a message, the picture as an address. */
export interface MessageAuthorView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** Someone a message mentions, as its chip names them (D-171). */
export type MentionedUserView = Pick<MessageAuthor, 'id' | 'username' | 'displayName'>

/** A role a message mentions in effect, by its name now (D-171). */
export interface MentionedRoleView {
    id: string
    name: string
}

/** The message a reply answers, as its reply line shows it, its mentions named (D-171). */
export interface RepliedMessageView extends Omit<RepliedMessage, 'author' | 'mentionUsers' | 'mentionRoleIds'> {
    author: MessageAuthorView | null
    mentionUsers: MentionedUserView[]
    mentionRoles: MentionedRoleView[]
}

/** A message as the API and the socket give it. */
export interface MessageView extends Omit<
    MessageRecord,
    'author' | 'replyTo' | 'systemUser' | 'mentionUsers' | 'mentionRoleIds'
> {
    author: MessageAuthorView | null
    replyTo: RepliedMessageView | null
    systemUser: MessageAuthorView | null
    mentionUsers: MentionedUserView[]
    /** Left out once deleted: the client shows its token as an unknown role. */
    mentionRoles: MentionedRoleView[]
}

/** Where messageViews finds people's pictures and roles' names. */
export interface MessageViewSources {
    users: UserDirectoryPort
    roles: RoleDirectoryPort
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
 * The records of one server's channel with each author's picture turned
 * into an address, the authors of the messages they answer and the people
 * system messages are about included, and the roles they mention named
 * (D-171). One signature per picture, however many messages share it: a
 * page of 50 from one conversation signs two or three; one read of the
 * roles for the page.
 */
export async function messageViews(
    { users, roles }: MessageViewSources,
    serverId: string,
    records: MessageRecord[]
): Promise<MessageView[]> {
    const authors = records.flatMap((record) => [record.author, record.replyTo?.author ?? null, record.systemUser])
    const keys = [...new Set(authors.map((author) => author?.avatarKey).filter((key) => !!key))] as string[]
    const roleIds = [
        ...new Set(records.flatMap((record) => [...record.mentionRoleIds, ...(record.replyTo?.mentionRoleIds ?? [])]))
    ]
    const [urls, named] = await Promise.all([
        Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)).then(
            (pairs) => new Map(pairs)
        ),
        roles.rolesOf(serverId, roleIds).then((found) => new Map(found.map((role) => [role.id, role.name])))
    ])
    const view = (author: MessageAuthor | null): MessageAuthorView | null =>
        author && {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            avatarUrl: author.avatarKey ? (urls.get(author.avatarKey) ?? null) : null
        }

    const mentions = ({ mentionUsers, mentionRoleIds }: Pick<MessageRecord, 'mentionUsers' | 'mentionRoleIds'>) => ({
        mentionUsers: mentionUsers.map(({ id, username, displayName }) => ({ id, username, displayName })),
        // A role deleted since is left out: the client shows its token as unknown.
        mentionRoles: mentionRoleIds.flatMap((id) => {
            const name = named.get(id)
            return name === undefined ? [] : [{ id, name }]
        })
    })

    return records.map(({ author, replyTo, systemUser, mentionUsers, mentionRoleIds, ...message }) => ({
        ...message,
        author: view(author),
        replyTo: replyTo && {
            id: replyTo.id,
            author: view(replyTo.author),
            content: replyTo.content,
            deleted: replyTo.deleted,
            ...mentions(replyTo)
        },
        systemUser: view(systemUser),
        ...mentions({ mentionUsers, mentionRoleIds })
    }))
}
