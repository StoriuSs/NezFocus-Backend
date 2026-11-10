import { Logger } from '@nestjs/common'
import {
    AccessMember,
    AccessServer,
    EVERYONE_DEFAULT_PERMISSIONS,
    PermissionCachePort,
    PermissionCheckerPort
} from '@/modules/permissions'
import {
    LayoutState,
    LayoutWrite,
    MAX_SERVERS_PER_USER,
    MaxServersReachedError,
    MissingPermissionError,
    ServerNotFoundError,
    serverPlan,
    ServerRepositoryPort
} from '../../../domain'
import { FileCleanupPort, IconStoragePort } from '../../ports'
import {
    CreateServerCommand,
    RemoveServerIconCommand,
    UpdateServerCommand,
    UploadServerIconCommand
} from './server.commands'
import {
    CreateServerHandler,
    RemoveServerIconHandler,
    UpdateServerHandler,
    UploadServerIconHandler
} from './server.handlers'

describe('CreateServerHandler', () => {
    it('builds the chosen template for the creator, under the 100-server limit', async () => {
        const servers = { create: jest.fn().mockResolvedValue({ serverId: 'ot' }) }
        const handler = new CreateServerHandler(servers as unknown as ServerRepositoryPort)

        await expect(handler.execute(new CreateServerCommand('an', 'Ôn thi', 'study'))).resolves.toEqual({
            serverId: 'ot'
        })
        expect(servers.create).toHaveBeenCalledWith({
            ownerId: 'an',
            name: 'Ôn thi',
            plan: serverPlan('study'),
            maxServers: MAX_SERVERS_PER_USER
        })
    })

    it('answers MAX_SERVERS_REACHED when the repository refuses for the limit', async () => {
        const servers = { create: jest.fn().mockResolvedValue(null) }
        const handler = new CreateServerHandler(servers as unknown as ServerRepositoryPort)

        const refused = handler.execute(new CreateServerCommand('an', 'Thứ 101', 'standard'))
        await expect(refused).rejects.toThrow(MaxServersReachedError)
        await expect(refused).rejects.toMatchObject({ kind: 'forbidden', errorKey: 'MAX_SERVERS_REACHED' })
    })
})

describe('UpdateServerHandler', () => {
    /** The owner of ÔT, with no channel: a rename is all there is to decide. */
    const STATE: LayoutState = {
        server: {
            id: 'ot',
            name: 'ÔT',
            iconKey: null,
            ownerId: 'an',
            welcomeChannelId: null,
            categories: [],
            channels: [],
            roles: [
                { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }
            ]
        },
        member: { userId: 'an', roleIds: [], timeoutUntil: null }
    }

    /** Runs the decision on STATE, as the repository would under its lock, and records the writes. */
    function setUp(found = true) {
        const written: LayoutWrite[] = []
        const servers = {
            changeLayout: jest.fn(
                async (_serverId: string, _userId: string, decide: (s: LayoutState) => LayoutWrite[]) => {
                    if (!found) return null
                    written.push(...decide(STATE))
                    return { createdId: null }
                }
            )
        }
        const cache = { serverChanged: jest.fn().mockResolvedValue(undefined) }
        const handler = new UpdateServerHandler(
            servers as unknown as ServerRepositoryPort,
            cache as unknown as PermissionCachePort
        )
        return { handler, servers, cache, written }
    }

    it('decides the change under the server lock and carries out what it decided', async () => {
        const { handler, servers, cache, written } = setUp()
        await handler.execute(new UpdateServerCommand('an', 'ot', { name: 'Ôn thi K22' }))
        expect(servers.changeLayout).toHaveBeenCalledWith('ot', 'an', expect.any(Function))
        expect(written).toEqual([{ kind: 'updateServer', changes: { name: 'Ôn thi K22' } }])
        // The name is not in the permission cache.
        expect(cache.serverChanged).not.toHaveBeenCalled()
    })

    it('answers not found when the server is gone or they are not in it', async () => {
        const { handler } = setUp(false)
        await expect(handler.execute(new UpdateServerCommand('an', 'ot', { name: 'x y' }))).rejects.toBeInstanceOf(
            ServerNotFoundError
        )
    })
})

describe('UploadServerIconHandler', () => {
    const server: AccessServer = {
        ownerId: 'an',
        roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
        channels: []
    }
    const member = (userId: string): AccessMember => ({ userId, roleIds: [], timeoutUntil: null })

    function setUp() {
        const checker = { access: jest.fn().mockResolvedValue({ server, member: member('an') }) }
        const servers = { replaceIcon: jest.fn() }
        const storage = {
            uploadIcon: jest.fn().mockResolvedValue('server-icons/new.webp'),
            deleteFile: jest.fn().mockResolvedValue(undefined),
            getReadUrl: jest.fn().mockResolvedValue('https://cdn.test/new.webp')
        }
        const cleanup = { deleteFileLater: jest.fn().mockResolvedValue(undefined) }
        const handler = new UploadServerIconHandler(
            checker as unknown as PermissionCheckerPort,
            servers as unknown as ServerRepositoryPort,
            storage as unknown as IconStoragePort,
            cleanup as unknown as FileCleanupPort
        )
        return { checker, servers, storage, cleanup, handler }
    }

    const command = (userId = 'an') => new UploadServerIconCommand(userId, 'ot', Buffer.from('image'))

    it('queues the icon it replaced and answers with a URL for the new one', async () => {
        const { servers, storage, cleanup, handler } = setUp()
        servers.replaceIcon.mockResolvedValue({ previousIconKey: 'server-icons/old.webp' })

        await expect(handler.execute(command())).resolves.toEqual({ iconUrl: 'https://cdn.test/new.webp' })
        expect(cleanup.deleteFileLater).toHaveBeenCalledWith('server-icons/old.webp')
        expect(storage.deleteFile).not.toHaveBeenCalled()
    })

    it('leaves no file behind when the server is gone meanwhile, or the write fails', async () => {
        const { servers, storage, handler } = setUp()

        servers.replaceIcon.mockResolvedValueOnce(null)
        await expect(handler.execute(command())).rejects.toThrow(ServerNotFoundError)
        expect(storage.deleteFile).toHaveBeenLastCalledWith('server-icons/new.webp')

        storage.deleteFile.mockClear()
        servers.replaceIcon.mockRejectedValueOnce(new Error('connection lost'))
        await expect(handler.execute(command())).rejects.toThrow('connection lost')
        expect(storage.deleteFile).toHaveBeenCalledWith('server-icons/new.webp')
    })

    it('still succeeds when the old file cannot be queued: the icon has changed', async () => {
        const { servers, cleanup, handler } = setUp()
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        servers.replaceIcon.mockResolvedValue({ previousIconKey: 'server-icons/old.webp' })
        cleanup.deleteFileLater.mockRejectedValue(new Error('queue down'))

        await expect(handler.execute(command())).resolves.toEqual({ iconUrl: 'https://cdn.test/new.webp' })
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })

    it('stores nothing for a member without MANAGE_SERVER, or someone not in the server', async () => {
        const { checker, storage, handler } = setUp()

        checker.access.mockResolvedValueOnce({ server, member: member('phong') })
        await expect(handler.execute(command('phong'))).rejects.toThrow(MissingPermissionError)

        checker.access.mockResolvedValueOnce(null)
        await expect(handler.execute(command('stranger'))).rejects.toThrow(ServerNotFoundError)

        expect(storage.uploadIcon).not.toHaveBeenCalled()
    })
})

describe('RemoveServerIconHandler', () => {
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
