import { toWire } from '@/modules/permissions'
import { validateAndTransform } from '@/shared/utils'
import { ServerListItem } from '../../application'
import { ServerResponseDto } from './dto'

/** Bits leave as decimal strings: JSON cannot carry a BigInt. */
export function presentServer(item: ServerListItem): ServerResponseDto {
    return validateAndTransform(ServerResponseDto, {
        ...item,
        permissions: toWire(item.permissions),
        channels: item.channels.map((channel) => ({ ...channel, permissions: toWire(channel.permissions) }))
    })
}
