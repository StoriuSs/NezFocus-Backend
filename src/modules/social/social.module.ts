import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { BLOCK_LIST } from '@/modules/notifications'
import { FRIENDS } from '@/modules/realtime'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { ServersModule } from '@/modules/servers/servers.module'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    BLOCK_COMMAND_HANDLERS,
    ForgetDeletedAccountHandler,
    NotifyRelationshipChangeHandler,
    PERSON_QUERY_HANDLERS,
    PublishRelationshipChangeHandler,
    RELATIONSHIP_COMMAND_HANDLERS,
    RELATIONSHIP_QUERY_HANDLERS,
    SOCIAL_LIMIT
} from './application'
import { RELATIONSHIP_REPOSITORY } from './domain'
import { PrismaRelationshipRepository, QueryBusBlockList, QueryBusFriends } from './infrastructure'
import { BlocksController, PeopleController, RelationshipsController } from './presentation'

/**
 * Friends, blocks, direct messages and one-to-one calls (SRS 4.9,
 * ARCHITECTURE 9). So far its tables and their checks (M6 L1, D-242), and
 * friends and blocks (L2, D-237, D-243): requests by username or from a
 * profile, a day's 50 of them, lookups and profiles with the servers two
 * people share; conversations come with L3, calls with L4.
 *
 * Asks users for people (USER_DIRECTORY), servers for the servers two
 * people share (MEMBERSHIP), realtime for presence (PRESENCE) and tells
 * each person's tabs through its EVENT_PUBLISHER; puts friend items in
 * inboxes through notifications' NOTIFIER (global). Hears users'
 * AccountDeletedEvent (D-243). Answers realtime's FRIENDS and
 * notifications' BLOCK_LIST through the global modules below. RateLimiter
 * comes from the global CacheModule.
 */
@Module({
    imports: [CqrsModule, RealtimeModule, ServersModule, UsersModule],
    controllers: [RelationshipsController, BlocksController, PeopleController],
    providers: [
        { provide: RELATIONSHIP_REPOSITORY, useClass: PrismaRelationshipRepository },
        { provide: SOCIAL_LIMIT, useExisting: RateLimiter },
        ...RELATIONSHIP_COMMAND_HANDLERS,
        ...BLOCK_COMMAND_HANDLERS,
        ...RELATIONSHIP_QUERY_HANDLERS,
        ...PERSON_QUERY_HANDLERS,
        PublishRelationshipChangeHandler,
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
