import { decideMentions, findMentions, MentionFacts, rolesNamedIn } from './mention.rules'

const AN = '0190a0b0-0000-7000-8000-00000000000a'
const BINH = '0190a0b0-0000-7000-8000-00000000000b'
const CHI = '0190a0b0-0000-7000-8000-00000000000c'
const LEADS = '0190a0b0-0000-7000-8000-0000000000f1'
const ADMINS = '0190a0b0-0000-7000-8000-0000000000f2'
const ELSEWHERE = '0190a0b0-0000-7000-8000-0000000000f3'
const GENERAL = '0190a0b0-0000-7000-8000-0000000000c1'

const facts = (over: Partial<MentionFacts> = {}): MentionFacts => ({
    authorId: AN,
    mayMentionEveryone: false,
    roles: [
        { id: LEADS, name: 'Trưởng nhóm', mentionable: true },
        { id: ADMINS, name: 'Quản trị', mentionable: false }
    ],
    answeredAuthorId: null,
    ...over
})

describe('Finding the mentions of a message (REQ-MSG-03, D-172)', () => {
    it('finds people, roles, channels and @everyone, each once, in the order written', () => {
        expect(findMentions(`<@${BINH}> <@&${LEADS}> <#${GENERAL}> @everyone <@${BINH}> <@${CHI}>`)).toEqual({
            userIds: [BINH, CHI],
            roleIds: [LEADS],
            channelIds: [GENERAL],
            everyone: true
        })
    })

    it('finds nothing in code or in a link', () => {
        expect(findMentions(`\`<@${BINH}>\` \`\`\`\n@everyone\n\`\`\` https://example.com/@everyone`)).toEqual({
            userIds: [],
            roleIds: [],
            channelIds: [],
            everyone: false
        })
    })

    it('takes @everyone only as a word of its own', () => {
        expect(findMentions('mail@everyone.example').everyone).toBe(false)
        expect(findMentions('@everyones').everyone).toBe(false)
        expect(findMentions('(@everyone!)').everyone).toBe(true)
    })

    it('leaves @here as words until it comes with presence (M2 L7)', () => {
        expect(findMentions('@here')).toEqual({ userIds: [], roleIds: [], channelIds: [], everyone: false })
    })

    it('takes only well-formed ids', () => {
        expect(findMentions('<@123> <@&not-an-id> <#>').userIds).toEqual([])
    })
})

describe('The roles a text names, to look up before deciding', () => {
    it('names each role once, in code too', () => {
        expect(rolesNamedIn(`<@&${LEADS}> \`<@&${ADMINS}>\` <@&${LEADS}> <@${BINH}>`)).toEqual([LEADS, ADMINS])
    })
})

describe('Deciding what a message may mention (REQ-MSG-03, MSG-09, D-39, D-172)', () => {
    it('keeps @everyone only for someone with MENTION_EVERYONE; for others it stays words', () => {
        expect(decideMentions('@everyone hi', facts()).mentions.everyone).toBe(false)
        expect(decideMentions('@everyone hi', facts()).content).toBe('@everyone hi')
        expect(decideMentions('@everyone hi', facts({ mayMentionEveryone: true })).mentions.everyone).toBe(true)
    })

    it('writes a name with formatting marks as words, so it changes nothing after it', () => {
        const decided = decideMentions(`<@&${ADMINS}> <@${BINH}>`, {
            ...facts(),
            roles: [{ id: ADMINS, name: '`**Quản trị', mentionable: false }]
        })
        expect(decided.content).toBe(`@\\\`\\*\\*Quản trị <@${BINH}>`)
        expect(decided.mentions.userIds).toEqual([BINH])
    })

    it('mentions a role people may mention, and turns one they may not into its name as words', () => {
        const decided = decideMentions(`<@&${LEADS}> and <@&${ADMINS}>`, facts())
        expect(decided.content).toBe(`<@&${LEADS}> and @Quản trị`)
        expect(decided.mentions.roleIds).toEqual([LEADS])
    })

    it('lets MENTION_EVERYONE mention any role', () => {
        const decided = decideMentions(`<@&${ADMINS}>`, facts({ mayMentionEveryone: true }))
        expect(decided.content).toBe(`<@&${ADMINS}>`)
        expect(decided.mentions.roleIds).toEqual([ADMINS])
    })

    it('mentions no role of another server, leaving its token for the client to show as unknown', () => {
        const decided = decideMentions(`<@&${ELSEWHERE}>`, facts())
        expect(decided.content).toBe(`<@&${ELSEWHERE}>`)
        expect(decided.mentions.roleIds).toEqual([])
    })

    it('mentions no role from code; one people may not mention becomes its name there too', () => {
        const decided = decideMentions(`\`<@&${ADMINS}>\` \`<@&${LEADS}>\``, facts())
        expect(decided.content).toBe(`\`@Quản trị\` \`<@&${LEADS}>\``)
        expect(decided.mentions.roleIds).toEqual([])
    })

    it('counts the people mentioned and the author of the message answered, never the sender', () => {
        expect(decideMentions(`<@${BINH}> <@${AN}>`, facts({ answeredAuthorId: CHI })).mentions.userIds).toEqual([
            BINH,
            CHI
        ])
        // Answering oneself, or mentioning oneself, is not about oneself (D-39, D-172).
        expect(decideMentions(`<@${AN}>`, facts({ answeredAuthorId: AN })).mentions.userIds).toEqual([])
    })

    it('counts the author answered once, even when also mentioned', () => {
        expect(decideMentions(`<@${BINH}>`, facts({ answeredAuthorId: BINH })).mentions.userIds).toEqual([BINH])
    })
})
