import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ChannelDirectoryPort, StudyRoomSettings } from '../../application/ports'

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

    async channelIdsOf(serverId: string): Promise<string[]> {
        const rows = await this.prisma.channel.findMany({ where: { serverId }, select: { id: true } })
        return rows.map((row) => row.id)
    }

    async studyRoomOf(channelId: string): Promise<StudyRoomSettings | null> {
        const row = await this.prisma.channel.findFirst({
            where: { id: channelId, type: 'voice', server: { deletedAt: null } },
            select: {
                serverId: true,
                isStudyRoom: true,
                studyStarter: true,
                studyFocusMinutes: true,
                studyShortBreakMinutes: true,
                studyLongBreakMinutes: true,
                studyLongBreakEvery: true
            }
        })
        return (
            row && {
                serverId: row.serverId,
                isStudyRoom: row.isStudyRoom,
                studyStarter: row.studyStarter,
                focusMinutes: row.studyFocusMinutes,
                shortBreakMinutes: row.studyShortBreakMinutes,
                longBreakMinutes: row.studyLongBreakMinutes,
                longBreakEvery: row.studyLongBreakEvery
            }
        )
    }
}
