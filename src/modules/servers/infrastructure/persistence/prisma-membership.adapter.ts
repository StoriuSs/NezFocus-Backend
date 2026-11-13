import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MembershipPort } from '../../application/ports'

/** MembershipPort, answered from the Member table (its index on userId). */
@Injectable()
export class PrismaMembership implements MembershipPort {
    constructor(private readonly prisma: PrismaService) {}

    async serverIdsOf(userId: string): Promise<string[]> {
        const rows = await this.prisma.member.findMany({
            where: { userId, server: { deletedAt: null } },
            select: { serverId: true }
        })
        return rows.map((row) => row.serverId)
    }
}
