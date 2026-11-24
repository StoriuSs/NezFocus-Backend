import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { DM_ACCESS } from '@/modules/messaging'
import { MessagingModule } from '@/modules/messaging/messaging.module'
import { BLOCK_LIST } from '@/modules/notifications'
import { DM_CHANNELS, FRIENDS } from '@/modules/realtime'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    BLOCK_COMMAND_HANDLERS,
    DM_COMMAND_HANDLERS,
    DM_QUERY_HANDLERS,
    ForgetDeletedAccountHandler,
    NotifyRelationshipChangeHandler,
    PERSON_QUERY_HANDLERS,
    PublishDmChangeHandler,
    PublishRelationshipChangeHandler,
    RELATIONSHIP_COMMAND_HANDLERS,
    RELATIONSHIP_QUERY_HANDLERS,
    SOCIAL_LIMIT
} from './application'
import { DM_REPOSITORY, RELATIONSHIP_REPOSITORY } from './domain'
import {
    PrismaDmRepository,
    PrismaRelationshipRepository,
    QueryBusBlockList,
    QueryBusDmAccess,
    QueryBusDmChannels,
    QueryBusFriends
} from './infrastructure'
import { BlocksController, DmsController, PeopleController, RelationshipsController } from './presentation'

/**
 * Friends, blocks, direct messages and one-to-one calls (SRS 4.9,
 * ARCHITECTURE 9). So far its tables and their checks (M6 L1, D-242), and
 * friends and blocks (L2, D-237, D-243): requests by username or from a
 * profile, a day's 50 of them, lookups and profiles with the servers two
 * people share; direct messages (L3, D-238, D-244): opening, closing, the
 * list, who may message whom; calls come with L4.
 *
 * Asks users for people (USER_DIRECTORY), servers for the servers two
 * people share (MEMBERSHIP), realtime for presence (PRESENCE) and tells
 * each person's tabs through its EVENT_PUBLISHER; puts friend items in
 * inboxes through notifications' NOTIFIER (global). Reads the last message
 * of each DM from messaging (LAST_MESSAGES); puts a new DM's sockets in its
 * room through realtime's DM_ROOMS. Hears users' AccountDeletedEvent
 * (D-243). Answers realtime's FRIENDS and DM_CHANNELS, notifications'
 * BLOCK_LIST and messaging's DM_ACCESS through the global modules below.
 * RateLimiter comes from the global CacheModule.
 */
@Module({
    imports: [CqrsModule, MessagingModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [RelationshipsController, BlocksController, PeopleController, DmsController],
    providers: [
        { provide: RELATIONSHIP_REPOSITORY, useClass: PrismaRelationshipRepository },
        { provide: DM_REPOSITORY, useClass: PrismaDmRepository },
        { provide: SOCIAL_LIMIT, useExisting: RateLimiter },
        ...RELATIONSHIP_COMMAND_HANDLERS,
        ...BLOCK_COMMAND_HANDLERS,
        ...RELATIONSHIP_QUERY_HANDLERS,
        ...PERSON_QUERY_HANDLERS,
        ...DM_COMMAND_HANDLERS,
        ...DM_QUERY_HANDLERS,
        PublishRelationshipChangeHandler,
        PublishDmChangeHandler,
        NotifyRelationshipChangeHandler,
        ForgetDeletedAccountHandler
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
