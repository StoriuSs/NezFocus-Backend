import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ChannelDirectoryPort, PlaceNames, StudyRoomSettings } from '../../application/ports'

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
        // A voice channel always has a server (Channel_dm_check): the test
        // only tells TypeScript so.
        if (!row?.serverId) return null
        return {
            serverId: row.serverId,
            isStudyRoom: row.isStudyRoom,
            studyStarter: row.studyStarter,
            focusMinutes: row.studyFocusMinutes,
            shortBreakMinutes: row.studyShortBreakMinutes,
            longBreakMinutes: row.studyLongBreakMinutes,
            longBreakEvery: row.studyLongBreakEvery
        }
    }

    async studyRoomsAmong(channelIds: string[]): Promise<string[]> {
        if (channelIds.length === 0) return []
        const rows = await this.prisma.channel.findMany({
            where: { id: { in: channelIds }, type: 'voice', isStudyRoom: true, server: { deletedAt: null } },
            select: { id: true }
        })
        return rows.map((row) => row.id)
    }

    async namesOf(serverIds: string[], channelIds: string[]): Promise<PlaceNames> {
        const [servers, channels] = await Promise.all([
            serverIds.length === 0
                ? []
                : this.prisma.server.findMany({
                      where: { id: { in: serverIds }, deletedAt: null },
                      select: { id: true, name: true }
                  }),
            channelIds.length === 0
                ? []
                : this.prisma.channel.findMany({
                      where: { id: { in: channelIds }, server: { deletedAt: null } },
                      select: { id: true, name: true }
                  })
        ])
        return {
            servers: new Map(servers.map((row) => [row.id, row.name])),
            channels: new Map(channels.map((row) => [row.id, row.name]))
        }
    }
}
