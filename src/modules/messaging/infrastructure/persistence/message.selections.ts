import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { findMentions, MessageAuthor, MessageFile, MessageRecord, StoredMessage } from '../../domain'

/** The client a Prisma transaction callback is given, for the helpers that run inside one. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

export const AUTHOR = { select: { id: true, username: true, displayName: true, avatarUrl: true } } as const

/** A message's files in the order sent; only checked ones are ever in one (D-93). */
const FILES = {
    select: {
        id: true,
        filename: true,
        size: true,
        contentType: true,
        storageKey: true,
        thumbnailKey: true,
        width: true,
        height: true
    },
    orderBy: { position: 'asc' }
} as const

/**
 * What the chat reads of a message: its author's name and picture key, the
 * message it answers as it is now (edited, or deleted), whether it is
 * pinned, and its mentions of many people. A system message's person and the
 * people its text mentions are read after (`toRecords`): no foreign key
 * leads there (D-168; a <@id> token is text, D-171).
 */
export const MESSAGE = {
    id: true,
    channelId: true,
    type: true,
    content: true,
    systemEvent: true,
    systemData: true,
    mentionEveryone: true,
    mentionHereUserIds: true,
    mentionRoleIds: true,
    editedAt: true,
    createdAt: true,
    author: AUTHOR,
    replyTo: {
        select: {
            id: true,
            content: true,
            deletedAt: true,
            mentionRoleIds: true,
            author: AUTHOR,
            attachments: { select: { width: true } }
        }
    },
    pin: { select: { pinnedAt: true } },
    attachments: FILES
} satisfies Prisma.MessageSelect

/** A message found by id or nonce: deleted ones too, saying so. */
export const STORED = { ...MESSAGE, deletedAt: true } satisfies Prisma.MessageSelect

export type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE }>
type StoredRow = Prisma.MessageGetPayload<{ select: typeof STORED }>
type AuthorRow = NonNullable<MessageRow['author']>

export const toAuthor = (author: AuthorRow): MessageAuthor => ({
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    avatarKey: author.avatarUrl
})

/** The person a system message is about (`systemData.userId`, D-168), if it names one. */
const subjectOf = (row: Pick<MessageRow, 'type' | 'systemData'>): string | null => {
    const userId = (row.systemData as { userId?: unknown } | null)?.userId
    return row.type === 'system' && typeof userId === 'string' ? userId : null
}

/** The people a row's <@id> tokens name, where they count (D-172): of the message, and of the one it answers. */
interface Named {
    own: string[]
    answered: string[]
}

const namedIn = (row: MessageRow): Named => ({
    own: row.type === 'regular' ? findMentions(row.content).userIds : [],
    answered: row.replyTo && !row.replyTo.deletedAt ? findMentions(row.replyTo.content).userIds : []
})

/** A file in a message: checked before it could be sent, so its type is known. */
const toFile = ({ contentType, ...file }: MessageRow['attachments'][number]): MessageFile => ({
    ...file,
    contentType: contentType ?? 'application/octet-stream'
})

const toRecord = (
    { author, systemData, replyTo, pin, attachments, ...row }: MessageRow,
    named: Named,
    people: Map<string, AuthorRow>
): MessageRecord => {
    const subject = subjectOf({ type: row.type, systemData })
    const person = subject ? people.get(subject) : undefined
    // An id of no account is left out.
    const read = (ids: string[]) =>
        ids.flatMap((id) => {
            const found = people.get(id)
            return found ? [toAuthor(found)] : []
        })
    return {
        ...row,
        author: author && toAuthor(author),
        systemData: (systemData as Record<string, unknown> | null) ?? null,
        // A deleted message is quoted by its id alone (REQ-MSG-05).
        replyTo:
            replyTo &&
            (replyTo.deletedAt
                ? {
                      id: replyTo.id,
                      author: null,
                      content: '',
                      deleted: true,
                      mentionRoleIds: [],
                      mentionUsers: [],
                      files: { count: 0, images: 0 }
                  }
                : {
                      id: replyTo.id,
                      author: replyTo.author && toAuthor(replyTo.author),
                      content: replyTo.content,
                      deleted: false,
                      mentionRoleIds: replyTo.mentionRoleIds,
                      mentionUsers: read(named.answered),
                      // An image is the one kind of file with a size.
                      files: {
                          count: replyTo.attachments.length,
                          images: replyTo.attachments.filter((file) => file.width !== null).length
                      }
                  }),
        pinned: pin !== null,
        systemUser: person ? toAuthor(person) : null,
        mentionUsers: read(named.own),
        attachments: attachments.map(toFile)
    }
}

/**
 * The rows as records, with the people their system messages are about and
 * the people their texts (and the texts they answer) mention: one read for
 * all of them.
 */
export async function toRecords(db: Tx, rows: MessageRow[]): Promise<MessageRecord[]> {
    const named = rows.map(namedIn)
    const wanted = rows.flatMap((row, index) => [subjectOf(row), ...named[index]!.own, ...named[index]!.answered])
    const ids = [...new Set(wanted.filter((id): id is string => id !== null))]
    const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, ...AUTHOR }) : []
    const byId = new Map(people.map((person) => [person.id, person]))
    return rows.map((row, index) => toRecord(row, named[index]!, byId))
}

export async function toRecordOf(db: Tx, row: MessageRow): Promise<MessageRecord> {
    return (await toRecords(db, [row]))[0]!
}

export async function toStored(db: Tx, { deletedAt, ...row }: StoredRow): Promise<StoredMessage> {
    return { ...(await toRecordOf(db, row)), deleted: deletedAt !== null }
}
