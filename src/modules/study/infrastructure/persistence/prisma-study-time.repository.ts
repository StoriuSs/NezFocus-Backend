import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { StudyCount, StudyTimeRepositoryPort } from '../../domain'
import { countParticipation } from './study-counts'

/** A count on its own, in a transaction of its own (D-224); the session's repository counts in its own transactions. */
@Injectable()
export class PrismaStudyTimeRepository implements StudyTimeRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    count(participationId: string, timeZone: string): Promise<StudyCount | null> {
        return this.prisma.$transaction((tx) => countParticipation(tx, participationId, timeZone, () => new Date()))
    }
}
