import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { Membership, MembershipPort } from '../../application/ports'

/** MembershipPort, answered from the Member table (its index on userId). */
@Injectable()
export class PrismaMembership implements MembershipPort {
    constructor(private readonly prisma: PrismaService) {}

    async serverIdsOf(userId: string): Promise<string[]> {
        return (await this.membershipsOf(userId)).map((membership) => membership.serverId)
    }

    async membershipsOf(userId: string): Promise<Membership[]> {
        return this.prisma.member.findMany({
            where: { userId, server: { deletedAt: null } },
            select: { serverId: true, joinedAt: true }
        })
    }
}
