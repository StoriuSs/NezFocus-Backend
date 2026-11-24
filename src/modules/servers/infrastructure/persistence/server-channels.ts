import { ChannelType as ChannelRowType } from '@/generated/prisma/client'
import { ChannelType } from '../../domain'

/**
 * The type of a channel read through its server. Conversations are channels
 * too (type dm, M6) but have no server (Channel_dm_check), so a read scoped to
 * a server never meets one; this tells TypeScript so, and stops at once if a
 * read forgot its server.
 */
export function serverChannelType(type: ChannelRowType): ChannelType {
    if (type === 'dm') throw new Error('A dm channel was read as a server channel: the read must name its server')
    return type
}
