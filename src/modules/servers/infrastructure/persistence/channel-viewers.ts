import { Prisma } from '@/generated/prisma/client'
import { ChannelViewers } from '@/modules/permissions'

/** Holds one of these roles in the server; `m` is the Member row. */
export const holdsOneOf = (roleIds: string[]) =>
    Prisma.sql`EXISTS (SELECT 1 FROM "MemberRole" r
        WHERE r."serverId" = m."serverId" AND r."userId" = m."userId" AND r."roleId" = ANY(${roleIds}::text[]))`

/**
 * Views the channel (D-192): the owner, one of `anyOf`, or one of every set
 * in `allOf` (channelViewers). `m` is the Member row, `s` its Server.
 */
export const viewing = ({ anyOf, allOf }: ChannelViewers) =>
    Prisma.sql`AND (s."ownerId" = m."userId" OR ${holdsOneOf(anyOf)} OR (${Prisma.join(allOf.map(holdsOneOf), ' AND ')}))`
