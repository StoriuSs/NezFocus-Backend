import * as application from '..'
import { ChangeLayout } from './change-layout'
import { ChangeRoles } from './change-roles'
import { Moderate } from './moderate'

/**
 * The permission cache hears of every change that can alter what someone may
 * do (D-146, D-157). Each base tells it after the commit, from the
 * writes the rule made; a command handler that goes around them has to be
 * listed here with the reason it changes nothing the cache holds.
 */

/** COMMAND_HANDLER_METADATA of @nestjs/cqrs, which its index does not export. */
const COMMAND_HANDLER = '__commandHandler__'

const BASES = [ChangeLayout, ChangeRoles, Moderate]

/** What the cache holds: the owner, the roles, the channels' access, and each member's roles and timeout. */
const OUTSIDE_THE_CACHE: Record<string, string> = {
    CreateServerHandler: 'a new server: nothing of it is cached yet',
    UploadServerIconHandler: 'the icon is not in the cache',
    RemoveServerIconHandler: 'the icon is not in the cache',
    CreateInviteHandler: 'invites are not in the cache',
    RevokeInviteHandler: 'invites are not in the cache',
    AcceptInviteHandler: 'a newcomer: "not a member" is never cached'
}

type HandlerClass = { name: string; prototype: object }

const commandHandlers = (Object.values(application) as unknown[]).filter(
    (value): value is HandlerClass => typeof value === 'function' && Reflect.hasMetadata(COMMAND_HANDLER, value)
)
const throughABase = (handler: HandlerClass) => BASES.some((base) => handler.prototype instanceof base)

describe('the permission cache hears of every change to access (D-146)', () => {
    it('finds the command handlers of the module', () => {
        // Fewer would mean the metadata key changed and the checks below pass on nothing.
        expect(commandHandlers.length).toBeGreaterThanOrEqual(24)
    })

    it('sends every command handler through a base that tells the cache, or lists why not', () => {
        const unaccounted = commandHandlers
            .filter((handler) => !throughABase(handler) && !(handler.name in OUTSIDE_THE_CACHE))
            .map((handler) => handler.name)
        expect(unaccounted).toEqual([])
    })

    it('lists no handler that is gone or that goes through a base after all', () => {
        const stale = Object.keys(OUTSIDE_THE_CACHE).filter((name) => {
            const handler = commandHandlers.find((candidate) => candidate.name === name)
            return !handler || throughABase(handler)
        })
        expect(stale).toEqual([])
    })
})
