import { Prisma } from '@/generated/prisma/client'
import { MembershipSnapshot } from '../../domain'

/** Everything one member's view of a server, or a change to its channel list, is decided from. */
export const membershipSelect = {
    userId: true,
    timeoutUntil: true,
    roles: { select: { roleId: true } },
    server: {
        select: {
            id: true,
            name: true,
            iconKey: true,
            ownerId: true,
            welcomeChannelId: true,
            categories: { select: { id: true, name: true, position: true } },
            roles: { select: { id: true, name: true, permissions: true, position: true, isEveryone: true } },
            channels: {
                select: {
                    id: true,
                    categoryId: true,
                    type: true,
                    name: true,
                    position: true,
                    isPrivate: true,
                    sendMode: true,
                    isStudyRoom: true,
                    taskBoardEnabled: true,
                    viewRoles: { select: { roleId: true } }
                }
            }
        }
    }
} satisfies Prisma.MemberSelect

/** The row `membershipSelect` reads, its type derived from the selection. */
type MembershipRow = Prisma.MemberGetPayload<{ select: typeof membershipSelect }>

export function toMembership({ server, ...member }: MembershipRow): MembershipSnapshot {
    return {
        server: {
            ...server,
            channels: server.channels.map(({ viewRoles, ...channel }) => ({
                ...channel,
                viewRoleIds: viewRoles.map((view) => view.roleId)
            }))
        },
        member: {
            userId: member.userId,
            roleIds: member.roles.map((role) => role.roleId),
            timeoutUntil: member.timeoutUntil
        }
    }
}
