import { EVERYONE_DEFAULT_PERMISSIONS } from '@/modules/permissions'
import { ServerSnapshot } from '../../../domain'
import { IconStoragePort, MembershipSnapshot, ServerRepositoryPort } from '../../ports'
import { ListMyServersQuery } from './list-my-servers.query'
import { ListMyServersHandler } from './list-my-servers.handler'

const snapshot = (id: string, iconKey: string | null): ServerSnapshot => ({
    id,
    name: id,
    iconKey,
    ownerId: 'an',
    welcomeChannelId: null,
    categories: [],
    channels: [],
    roles: [
        {
            id: `${id}-everyone`,
            name: '@everyone',
            permissions: EVERYONE_DEFAULT_PERMISSIONS,
            position: 0,
            isEveryone: true
        }
    ]
})

describe('ListMyServersHandler', () => {
    it('keeps the join order, and gives a URL only to a server with an icon', async () => {
        const rows: MembershipSnapshot[] = [
            {
                server: snapshot('ot', 'server-icons/ot.webp'),
                member: { userId: 'an', roleIds: [], timeoutUntil: null }
            },
            { server: snapshot('nd', null), member: { userId: 'an', roleIds: [], timeoutUntil: null } }
        ]
        const servers = { listForMember: jest.fn().mockResolvedValue(rows) }
        const storage = { getReadUrl: jest.fn().mockResolvedValue('https://cdn.test/ot.webp') }
        const handler = new ListMyServersHandler(
            servers as unknown as ServerRepositoryPort,
            storage as unknown as IconStoragePort
        )

        const items = await handler.execute(new ListMyServersQuery('an', 'ot'))
        expect(servers.listForMember).toHaveBeenCalledWith('an', 'ot')
        expect(items.map((item) => [item.id, item.iconUrl, item.isOwner])).toEqual([
            ['ot', 'https://cdn.test/ot.webp', true],
            ['nd', null, true]
        ])
        expect(storage.getReadUrl).toHaveBeenCalledTimes(1)
    })
})
