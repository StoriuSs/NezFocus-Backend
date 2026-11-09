import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { MissingPermissionError, ServerNotFoundError } from '../../../domain'
import { FileCleanupPort, ServerRepositoryPort } from '../../ports'
import { RemoveServerIconCommand } from './remove-icon.command'
import { RemoveServerIconHandler } from './remove-icon.handler'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: []
}

function setUp(userId = 'an') {
    const checker = {
        access: jest.fn().mockResolvedValue({ server, member: { userId, roleIds: [], timeoutUntil: null } })
    }
    const servers = { replaceIcon: jest.fn() }
    const cleanup = { deleteFileLater: jest.fn().mockResolvedValue(undefined) }
    const handler = new RemoveServerIconHandler(
        checker as unknown as PermissionCheckerPort,
        servers as unknown as ServerRepositoryPort,
        cleanup as unknown as FileCleanupPort
    )
    return { checker, servers, cleanup, handler }
}

describe('RemoveServerIconHandler', () => {
    it('clears the icon and queues its file; without one it answers the same and queues nothing', async () => {
        const { servers, cleanup, handler } = setUp()
        servers.replaceIcon.mockResolvedValueOnce({ previousIconKey: 'server-icons/old.webp' })
        await handler.execute(new RemoveServerIconCommand('an', 'ot'))
        expect(servers.replaceIcon).toHaveBeenCalledWith('ot', null)
        expect(cleanup.deleteFileLater).toHaveBeenCalledWith('server-icons/old.webp')

        cleanup.deleteFileLater.mockClear()
        servers.replaceIcon.mockResolvedValueOnce({ previousIconKey: null })
        await handler.execute(new RemoveServerIconCommand('an', 'ot'))
        expect(cleanup.deleteFileLater).not.toHaveBeenCalled()
    })

    it('answers not found when the server is gone by the time it writes', async () => {
        const { servers, handler } = setUp()
        servers.replaceIcon.mockResolvedValue(null)
        await expect(handler.execute(new RemoveServerIconCommand('an', 'ot'))).rejects.toThrow(ServerNotFoundError)
    })

    it('changes nothing for a member without MANAGE_SERVER', async () => {
        const { servers, handler } = setUp('phong')
        await expect(handler.execute(new RemoveServerIconCommand('phong', 'ot'))).rejects.toThrow(
            MissingPermissionError
        )
        expect(servers.replaceIcon).not.toHaveBeenCalled()
    })
})
