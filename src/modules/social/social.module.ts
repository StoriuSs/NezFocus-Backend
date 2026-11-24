import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { DM_ACCESS } from '@/modules/messaging'
import { MessagingModule } from '@/modules/messaging/messaging.module'
import { BLOCK_LIST } from '@/modules/notifications'
import { DM_CHANNELS, FRIENDS } from '@/modules/realtime'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { MEMBER_ACTIVITY } from '@/modules/servers'
import { ServersModule } from '@/modules/servers/servers.module'
import { StudyModule } from '@/modules/study/study.module'
import { UsersModule } from '@/modules/users/users.module'
import { ACTIVE_CALLS } from '@/modules/voice'
import { VoiceModule } from '@/modules/voice/voice.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    ACTIVITY_LOCK,
    ACTIVITY_QUERY_HANDLERS,
    AnnounceActivityHandler,
    BLOCK_COMMAND_HANDLERS,
    CALL_COMMAND_HANDLERS,
    CALL_JOBS,
    CALL_MEDIA_COMMAND_HANDLERS,
    CALL_QUERY_HANDLERS,
    CloseEndedCallRoomHandler,
    DM_COMMAND_HANDLERS,
    DM_QUERY_HANDLERS,
    EndBlockedCallsHandler,
    EndDeletedAccountCallsHandler,
    ForgetDeletedAccountHandler,
    LeaveEndedSessionCallsHandler,
    NotifyRelationshipChangeHandler,
    PERSON_QUERY_HANDLERS,
    PublishCallChangeHandler,
    PublishDmChangeHandler,
    PublishRelationshipChangeHandler,
    RecordCallEndHandler,
    RecordCallMediaHandler,
    RELATIONSHIP_COMMAND_HANDLERS,
    RELATIONSHIP_QUERY_HANDLERS,
    SOCIAL_LIMIT,
    StudyActivities
} from './application'
import { CALL_REPOSITORY, DM_REPOSITORY, RELATIONSHIP_REPOSITORY } from './domain'
import {
    BullMqCallJobs,
    CommandBusActiveCalls,
    PrismaActivityLock,
    PrismaCallRepository,
    PrismaDmRepository,
    PrismaRelationshipRepository,
    QueryBusBlockList,
    QueryBusDmAccess,
    QueryBusDmChannels,
    QueryBusFriends,
    QueryBusMemberActivity
} from './infrastructure'
import {
    BlocksController,
    CallsController,
    DmsController,
    PeopleController,
    RelationshipsController,
    SocialJobsConsumer
} from './presentation'

/**
 * Friends, blocks, direct messages and one-to-one calls (SRS 4.9,
 * ARCHITECTURE 9). So far its tables and their checks (M6 L1, D-242), and
 * friends and blocks (L2, D-237, D-243): requests by username or from a
 * profile, a day's 50 of them, lookups and profiles with the servers two
 * people share; direct messages (L3, D-238, D-244): opening, closing, the
 * list, who may message whom; calls (L4a, D-239, D-245): calling,
 * answering, declining, hanging up, busy, 45 seconds of ringing on the
 * `social` queue (and its sweep), the call's message in the DM and the
 * missed call's item; their media (L4b, D-242, D-246): joining the call's
 * room, 15 seconds to connect and 30 to come back (a job on the same queue),
 * the rooms set right by the sweep, ended sessions put out; the study
 * activity line (L5, D-240, D-247): on the lists, the profile and the member
 * list, told again as `activity.updated`.
 *
 * Asks users for people (USER_DIRECTORY), servers for the servers two
 * people share (MEMBERSHIP), realtime for presence (PRESENCE) and tells
 * each person's tabs through its EVENT_PUBLISHER; puts friend items in
 * inboxes through notifications' NOTIFIER (global). Reads the last message
 * of each DM from messaging (LAST_MESSAGES); puts a new DM's sockets in its
 * room through realtime's DM_ROOMS; writes a call's message through
 * messaging's PostCallEndedCommand over the bus; the calls' rooms at
 * LiveKit through voice's CALL_MEDIA. Hears users' AccountDeletedEvent
 * (D-243), auth's AccountDeletionRequestedEvent (a call cut off) and
 * SessionsEndedEvent (D-214), voice's CallMediaChangedEvent. For the
 * activity line, reads voice's VOICE_ROOMS, servers' CHANNEL_DIRECTORY,
 * study's SOLO_SESSIONS and each person's settings, and hears voice's
 * VoiceStateChangedEvent, study's FocusSessionChangedEvent, users'
 * PresenceChosenEvent and StudyActivitySwitchedEvent, servers'
 * ServerChangedEvent. Answers realtime's FRIENDS and DM_CHANNELS,
 * notifications' BLOCK_LIST, messaging's DM_ACCESS, voice's ACTIVE_CALLS
 * and servers' MEMBER_ACTIVITY through the global modules below.
 * RateLimiter comes from the global CacheModule.
 */
@Module({
    imports: [
        CqrsModule,
        MessagingModule,
        RealtimeModule,
        ServersModule,
        StudyModule,
        UsersModule,
        VoiceModule,
        registerQueues(QUEUES.SOCIAL)
    ],
    controllers: [RelationshipsController, BlocksController, PeopleController, DmsController, CallsController],
    providers: [
        { provide: RELATIONSHIP_REPOSITORY, useClass: PrismaRelationshipRepository },
        { provide: DM_REPOSITORY, useClass: PrismaDmRepository },
        { provide: CALL_REPOSITORY, useClass: PrismaCallRepository },
        { provide: CALL_JOBS, useClass: BullMqCallJobs },
        { provide: SOCIAL_LIMIT, useExisting: RateLimiter },
        StudyActivities,
        { provide: ACTIVITY_LOCK, useClass: PrismaActivityLock },
        ...RELATIONSHIP_COMMAND_HANDLERS,
        ...BLOCK_COMMAND_HANDLERS,
        ...RELATIONSHIP_QUERY_HANDLERS,
        ...PERSON_QUERY_HANDLERS,
        ...DM_COMMAND_HANDLERS,
        ...DM_QUERY_HANDLERS,
        ...CALL_COMMAND_HANDLERS,
        ...CALL_MEDIA_COMMAND_HANDLERS,
        ...CALL_QUERY_HANDLERS,
        ...ACTIVITY_QUERY_HANDLERS,
        PublishRelationshipChangeHandler,
        PublishDmChangeHandler,
        PublishCallChangeHandler,
        RecordCallEndHandler,
        RecordCallMediaHandler,
        CloseEndedCallRoomHandler,
        LeaveEndedSessionCallsHandler,
        EndBlockedCallsHandler,
        EndDeletedAccountCallsHandler,
        NotifyRelationshipChangeHandler,
        ForgetDeletedAccountHandler,
        AnnounceActivityHandler,
        SocialJobsConsumer
    ]
})
export class SocialModule {}

/**
 * Realtime's FRIENDS port (whom presence also goes to, D-242), answered by
 * this module. Global, so RealtimeModule finds it without importing this
 * module, which imports RealtimeModule: the code depends one way only,
 * social on realtime (as D-180, D-205). The adapter only sends this
 * module's query over the bus. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: FRIENDS, useClass: QueryBusFriends }],
    exports: [FRIENDS]
})
export class FriendsModule {}

/**
 * Notifications' BLOCK_LIST port (whom people blocked, D-242), answered by
 * this module the same way: social calls notifications' NOTIFIER, never the
 * other way. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: BLOCK_LIST, useClass: QueryBusBlockList }],
    exports: [BLOCK_LIST]
})
export class BlockListModule {}

/**
 * Realtime's DM_CHANNELS port (the DMs whose rooms a socket joins, D-242),
 * answered by this module the same way as FRIENDS. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: DM_CHANNELS, useClass: QueryBusDmChannels }],
    exports: [DM_CHANNELS]
})
export class DmChannelsModule {}

/**
 * Messaging's DM_ACCESS port (a DM's two people, who may still message the
 * other, the DMs shown in a list; D-238, D-244), answered by this module:
 * it imports messaging, never the other way. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: DM_ACCESS, useClass: QueryBusDmAccess }],
    exports: [DM_ACCESS]
})
export class DmAccessModule {}

/**
 * Voice's ACTIVE_CALLS port (joining a voice room ends one's active call,
 * D-246), answered by this module the same way: social uses voice's
 * CALL_MEDIA, never the other way. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: ACTIVE_CALLS, useClass: CommandBusActiveCalls }],
    exports: [ACTIVE_CALLS]
})
export class ActiveCallsModule {}

/**
 * Servers' MEMBER_ACTIVITY port (the activity line in the member list,
 * D-247), answered by this module the same way: social uses servers, never
 * the other way. AppModule imports it.
 */
@Global()
@Module({
    imports: [CqrsModule],
    providers: [{ provide: MEMBER_ACTIVITY, useClass: QueryBusMemberActivity }],
    exports: [MEMBER_ACTIVITY]
})
export class MemberActivityModule {}
