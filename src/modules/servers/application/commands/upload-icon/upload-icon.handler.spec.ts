import { Logger } from '@nestjs/common'
import { AccessMember, AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { MissingPermissionError, ServerNotFoundError } from '../../../domain'
import { FileCleanupPort, IconStoragePort, ServerRepositoryPort } from '../../ports'
import { UploadServerIconCommand } from './upload-icon.command'
import { UploadServerIconHandler } from './upload-icon.handler'

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

describe('UploadServerIconHandler', () => {
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
