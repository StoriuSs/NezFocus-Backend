import { proseText } from './message-markdown'

/*
 * Mentions are kept as tokens in the text (schema, D-164): <@userId> a
 * person, <@&roleId> a role, <#channelId> a channel, and @everyone. Renaming
 * a person, role or channel leaves old messages right; the client draws each
 * token with the names the message carries (D-171). @here is a word like
 * @everyone; whom it reached is kept with the message (D-166).
 */

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TOKEN = new RegExp(`<(@&|@|#)(${ID})>`, 'g')
/** @everyone as a word of its own: not inside an address or a longer word. */
const EVERYONE = /(?<![\p{L}\p{N}_@.])@everyone(?![\p{L}\p{N}_])/u
/** @here, the same way. */
const HERE = /(?<![\p{L}\p{N}_@.])@here(?![\p{L}\p{N}_])/u
const ROLE_TOKEN = new RegExp(`<@&(${ID})>`, 'g')
/** The formatting marks a backslash keeps as words (`message-markdown.ts`). */
const MARK = /[\\*_~`>]/g

/** The mentions written in a message where they count: never in code or a link (D-172). */
export interface FoundMentions {
    /** Each once, in the order first written. */
    userIds: string[]
    roleIds: string[]
    channelIds: string[]
    everyone: boolean
    here: boolean
}

export function findMentions(content: string): FoundMentions {
    const found = { userIds: new Set<string>(), roleIds: new Set<string>(), channelIds: new Set<string>() }
    let everyone = false
    let here = false
    for (const text of proseText(content)) {
        for (const [, kind, id] of text.matchAll(TOKEN))
            (kind === '@' ? found.userIds : kind === '@&' ? found.roleIds : found.channelIds).add(id!)
        everyone ||= EVERYONE.test(text)
        here ||= HERE.test(text)
    }
    return {
        userIds: [...found.userIds],
        roleIds: [...found.roleIds],
        channelIds: [...found.channelIds],
        everyone,
        here
    }
}

/** Every role a token names, code included: `decideMentions` turns one there into words too. */
export const rolesNamedIn = (content: string): string[] => [
    ...new Set(Array.from(content.matchAll(ROLE_TOKEN), ([, id]) => id!))
]

/** A role of the message's server, as the decision needs it (@everyone's own role is never one). */
export interface MentionRole {
    id: string
    name: string
    /** "Let everyone mention this role" (REQ-MSG-03). */
    mentionable: boolean
}

export interface MentionFacts {
    authorId: string
    /** MENTION_EVERYONE in the channel: @everyone, @here, and any role. */
    mayMentionEveryone: boolean
    /** The roles of the server the message names; a token naming no role here is not one. */
    roles: MentionRole[]
    /** Who wrote the message this one answers; null when it answers none, or one deleted. */
    answeredAuthorId: string | null
}

/** What a saved message mentions in effect (REQ-MSG-03, D-164). */
export interface MessageMentions {
    everyone: boolean
    /** @here in effect (D-166): `hereUserIds` says whom it reached. */
    here: boolean
    roleIds: string[]
    /**
     * Who it is about in their own right (MessageMention, D-39): those
     * mentioned and the author answered, never the sender (D-172). Those who
     * cannot see the channel are left out by the caller.
     */
    userIds: string[]
    /**
     * Whom @here reached: those who see the channel and are not offline as
     * it is sent (D-166), never the sender. Filled by the caller, who reads
     * presence; empty here.
     */
    hereUserIds: string[]
}

/**
 * The text as it is kept, and what it mentions in effect (REQ-MSG-03). A
 * role the author may not mention becomes its name as words, wherever it
 * is ("shown as typed, no one mentioned"), its formatting marks escaped so
 * the name changes nothing after it; @everyone and @here without
 * MENTION_EVERYONE are words already. A role of no role here keeps its
 * token and mentions no one: the client shows it as unknown, as it does a
 * role deleted later.
 */
export function decideMentions(content: string, facts: MentionFacts): { content: string; mentions: MessageMentions } {
    const roles = new Map(facts.roles.map((role) => [role.id, role]))
    const allowed = (role: MentionRole) => role.mentionable || facts.mayMentionEveryone
    const kept = content.replace(ROLE_TOKEN, (token, id: string) => {
        const role = roles.get(id)
        return role && !allowed(role) ? `@${role.name.replace(MARK, '\\$&')}` : token
    })

    const found = findMentions(kept)
    const people = [...found.userIds, ...(facts.answeredAuthorId ? [facts.answeredAuthorId] : [])]
    return {
        content: kept,
        mentions: {
            everyone: found.everyone && facts.mayMentionEveryone,
            here: found.here && facts.mayMentionEveryone,
            roleIds: found.roleIds.filter((id) => roles.has(id)),
            userIds: [...new Set(people)].filter((id) => id !== facts.authorId),
            hereUserIds: []
        }
    }
}
