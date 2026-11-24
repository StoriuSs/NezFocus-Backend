import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { SoloSessionsPort, SoloState } from '../../application/ports'

/** SoloSessionsPort, answered from the FocusSession table. */
@Injectable()
export class PrismaSoloSessions implements SoloSessionsPort {
    constructor(private readonly prisma: PrismaService) {}

    async solosOf(userIds: string[]): Promise<SoloState[]> {
        if (userIds.length === 0) return []
        // `<> 'ended'`, as FocusSession_one_open_solo_per_person is written: so that index is used.
        const rows = await this.prisma.focusSession.findMany({
            where: { userId: { in: userIds }, status: { not: 'ended' } },
            select: { userId: true, status: true, phase: true, phaseEndsAt: true }
        })
        return rows.flatMap(({ userId, status, phase, phaseEndsAt }) =>
            // Only a Solo has a person (FocusSession_kind_check), and an open one is not ended.
            userId && status !== 'ended' ? [{ userId, status, phase, phaseEndsAt }] : []
        )
    }
}
