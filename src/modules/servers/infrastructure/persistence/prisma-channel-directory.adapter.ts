import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ChannelDirectoryPort } from '../../application/ports'

/** ChannelDirectoryPort, answered from the Channel table (its primary key). */
@Injectable()
export class PrismaChannelDirectory implements ChannelDirectoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async serverIdOf(channelId: string): Promise<string | null> {
        const row = await this.prisma.channel.findFirst({
            where: { id: channelId, server: { deletedAt: null } },
            select: { serverId: true }
        })
        return row?.serverId ?? null
    }
}
