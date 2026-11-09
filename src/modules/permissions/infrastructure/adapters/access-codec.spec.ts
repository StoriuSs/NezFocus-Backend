import { AccessMember, AccessServer, Permission } from '../../domain'
import { decodeMember, decodeServer, encodeMember, encodeServer } from './access-codec'

/** Through JSON, as Redis stores it. */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('access codec', () => {
    it('brings a server back with its bits intact, the high ones included', () => {
        const server: AccessServer = {
            ownerId: 'o',
            roles: [
                {
                    id: 'e',
                    permissions: Permission.VIEW_CHANNEL | Permission.MANAGE_TASKS,
                    position: 0,
                    isEveryone: true
                }
            ],
            channels: [{ id: 'c', type: 'voice', isPrivate: true, viewRoleIds: ['e'], sendMode: 'managers' }]
        }
        expect(decodeServer(viaJson(encodeServer(server)))).toEqual(server)
    })

    it('brings a timeout back as a date, and none as none', () => {
        const timedOut: AccessMember = { userId: 'u', roleIds: ['r'], timeoutUntil: new Date('2026-11-09T10:00:00Z') }
        const free: AccessMember = { userId: 'u', roleIds: [], timeoutUntil: null }
        expect(decodeMember(viaJson(encodeMember(timedOut)))).toEqual(timedOut)
        expect(decodeMember(viaJson(encodeMember(free)))).toEqual(free)
    })
})
