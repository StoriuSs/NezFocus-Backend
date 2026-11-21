import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CqrsModule } from '@nestjs/cqrs'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ROOM_SESSIONS } from '@/modules/servers'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { VoiceModule } from '@/modules/voice/voice.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import {
    PostSessionMessageHandler,
    PublishFocusSessionHandler,
    PublishStreakUpdatedHandler,
    ROOM_SESSION_COMMAND_HANDLERS,
    ROOM_SESSION_QUERY_HANDLERS,
    SchedulePhaseEndHandler,
    SESSION_CONTROL_COMMAND_HANDLERS,
    SESSION_JOBS,
    SESSION_TIMER_COMMAND_HANDLERS,
    STUDY_SETTINGS,
    StudySettings
} from './application'
import { FOCUS_SESSION_REPOSITORY, STUDY_TIME_REPOSITORY } from './domain'
import {
    BullMqSessionJobs,
    PrismaFocusSessionRepository,
    PrismaStudyTimeRepository,
    QueryBusRoomSessions
} from './infrastructure'
import { FocusSessionsController, StudyJobsConsumer } from './presentation'

/**
 * Study sessions (SRS 4.6, ARCHITECTURE 5): Room Sessions in study rooms,
 * Solo sessions, the seconds studied each day, streaks. So far the Room
 * Sessions started and controlled from inside their room, their phases
 * moved by the study queue (M5 L3a), and the counting of the seconds studied
 * (L2); who joins and leaves comes with L3b, Solo with L4.
 *
 * Asks servers for a room's study settings (CHANNEL_DIRECTORY), permissions
 * what someone may do there (PERMISSION_CHECKER), voice who is in a room
 * (VOICE_ROOMS, D-225), users each person's time zone (USER_DIRECTORY).
 * Tells the room and each person through realtime's EVENT_PUBLISHER, and
 * says a start and an end in the room's chat through messaging's
 * PostStudySessionCommand, sent over the bus. Answers servers' ROOM_SESSIONS
 * through RoomSessionsModule below. The sweep of src/maintenance runs a
 * phase end whose job was lost (D-225).
 *
 * ConfigService comes from the global ConfigModule (study.config.ts).
 */
@Module({
    imports: [
        CqrsModule,
        PermissionsModule,
        RealtimeModule,
        ServersModule,
        UsersModule,
        VoiceModule,
        registerQueues(QUEUES.STUDY)
    ],
    controllers: [FocusSessionsController],
    providers: [
        { provide: STUDY_TIME_REPOSITORY, useClass: PrismaStudyTimeRepository },
        { provide: FOCUS_SESSION_REPOSITORY, useClass: PrismaFocusSessionRepository },
        { provide: SESSION_JOBS, useClass: BullMqSessionJobs },
        ...ROOM_SESSION_COMMAND_HANDLERS,
        ...SESSION_CONTROL_COMMAND_HANDLERS,
        ...SESSION_TIMER_COMMAND_HANDLERS,
        ...ROOM_SESSION_QUERY_HANDLERS,
        PublishStreakUpdatedHandler,
        PublishFocusSessionHandler,
        SchedulePhaseEndHandler,
        PostSessionMessageHandler,
        StudyJobsConsumer,
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

/**
 * Servers' ROOM_SESSIONS port (the study session of each voice room in GET
 * /servers, D-220), answered by this module. Global, so ServersModule finds
 * it without importing this module, which imports ServersModule: the code
 * depends one way only, study on servers (as D-180, D-205). The adapter only
 * sends this module's query over the bus, so it needs nothing but
 * CqrsModule. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: ROOM_SESSIONS, useClass: QueryBusRoomSessions }],
    exports: [ROOM_SESSIONS]
})
export class RoomSessionsModule {}
