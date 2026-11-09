import { MAX_SERVERS_PER_USER, MaxServersReachedError, serverPlan } from '../../../domain'
import { ServerRepositoryPort } from '../../ports'
import { CreateServerCommand } from './create-server.command'
import { CreateServerHandler } from './create-server.handler'

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
