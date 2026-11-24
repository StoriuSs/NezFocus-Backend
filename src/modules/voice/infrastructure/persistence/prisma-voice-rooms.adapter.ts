import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { RoomOccupancy, VoiceRoomsPort } from '../../application/ports'

const OCCUPANCY = { userId: true, channelId: true, joinedAt: true } as const

/** VoiceRoomsPort, answered from the VoiceState table (its primary key, and its index by room). */
@Injectable()
export class PrismaVoiceRooms implements VoiceRoomsPort {
    constructor(private readonly prisma: PrismaService) {}

    peopleIn(channelId: string): Promise<RoomOccupancy[]> {
        return this.prisma.voiceState.findMany({
            where: { channelId },
            select: OCCUPANCY,
            orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }]
        })
    }

    roomOf(userId: string): Promise<RoomOccupancy | null> {
        return this.prisma.voiceState.findUnique({ where: { userId }, select: OCCUPANCY })
    }

    async roomsOf(userIds: string[]): Promise<RoomOccupancy[]> {
        if (userIds.length === 0) return []
        return this.prisma.voiceState.findMany({ where: { userId: { in: userIds } }, select: OCCUPANCY })
    }

    async peopleInRooms(channelIds: string[]): Promise<RoomOccupancy[]> {
        if (channelIds.length === 0) return []
        return this.prisma.voiceState.findMany({ where: { channelId: { in: channelIds } }, select: OCCUPANCY })
    }
}
