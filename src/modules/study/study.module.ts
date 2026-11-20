import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { STUDY_SETTINGS, StudySettings } from './application'

/**
 * Study sessions (SRS 4.6, ARCHITECTURE 5): Room Sessions in study rooms,
 * Solo sessions, the seconds studied each day, streaks. So far the tables,
 * the settings and the study queue (M5 L1); the rules come with L2, the
 * sessions with L3 and L4.
 *
 * ConfigService comes from the global ConfigModule (study.config.ts).
 */
@Module({
    imports: [registerQueues(QUEUES.STUDY)],
    providers: [
        {
            provide: STUDY_SETTINGS,
            inject: [ConfigService],
            useFactory: (config: ConfigService): StudySettings => {
                const minuteMs = config.get<number>('study.minuteMs')
                // Every timed job is a number of these: without one, each
                // would be set for NaN. Missing means study.config.ts is not
                // loaded by AppModule.
                if (!Number.isInteger(minuteMs) || minuteMs! <= 0) {
                    throw new Error(`study.minuteMs must be a whole number of ms above 0, not ${minuteMs}`)
                }
                return { minuteMs: minuteMs! }
            }
        }
    ]
})
export class StudyModule {}
