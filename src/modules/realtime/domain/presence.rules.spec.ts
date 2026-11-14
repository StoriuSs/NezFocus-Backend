import { liveSockets, SILENCE_MS, shownPresence, type SocketPresence } from './presence.rules'

const NOW = Date.parse('2026-11-14T10:00:00Z')
const active: SocketPresence = { idle: false, seenAt: NOW - 5_000 }
const idle: SocketPresence = { idle: true, seenAt: NOW - 5_000 }

describe('What others see of a person (REQ-AUTH-07)', () => {
    const shown = (chosen: Parameters<typeof shownPresence>[0]['chosen'], sockets: SocketPresence[]) =>
        shownPresence({ chosen, sockets, held: 'offline', lastSeenAt: NOW, now: NOW })

    it('is online while any tab is in use', () => {
        expect(shown('online', [idle, active])).toBe('online')
    })

    it('is away once every tab has gone unused', () => {
        expect(shown('online', [idle, idle])).toBe('idle')
    })

    it('stays do not disturb when every tab has gone unused: away does not override it', () => {
        expect(shown('dnd', [idle])).toBe('dnd')
    })

    it('is away when away is chosen, though a tab is in use', () => {
        expect(shown('idle', [active])).toBe('idle')
    })

    it('is offline when invisible is chosen', () => {
        expect(shown('invisible', [active])).toBe('offline')
    })
})

describe('Once no tab is connected (REQ-AUTH-07)', () => {
    it('keeps what was shown for 60 seconds: a page reload does not flash offline', () => {
        const shown = shownPresence({
            chosen: 'online',
            sockets: [],
            held: 'dnd',
            lastSeenAt: NOW - SILENCE_MS,
            now: NOW
        })
        expect(shown).toBe('dnd')
    })

    it('is offline after 60 seconds', () => {
        const shown = shownPresence({
            chosen: 'online',
            sockets: [],
            held: 'online',
            lastSeenAt: NOW - SILENCE_MS - 1,
            now: NOW
        })
        expect(shown).toBe('offline')
    })
})

describe('The tabs still connected', () => {
    it('leave out one not heard from for over 60 seconds: its app instance went without saying', () => {
        const silent = { idle: false, seenAt: NOW - SILENCE_MS - 1 }
        const heard = { idle: true, seenAt: NOW - SILENCE_MS }
        expect(liveSockets([silent, heard], NOW)).toEqual([heard])
    })
})
