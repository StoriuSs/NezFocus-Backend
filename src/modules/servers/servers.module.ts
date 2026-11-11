import { Global, Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { SERVER_OWNERSHIP } from '@/modules/auth'
import { AuthModule } from '@/modules/auth/auth.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { UploadModule } from '@/shared/infrastructure/storage/upload.module'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { UsersModule } from '@/modules/users/users.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    INVITE_REPOSITORY,
    MEMBER_REPOSITORY,
    MODERATION_REPOSITORY,
    ROLE_REPOSITORY,
    SERVER_REPOSITORY
} from './domain'
import {
    CHANNEL_LAYOUT_COMMAND_HANDLERS,
    FILE_CLEANUP,
    GUESS_LIMIT,
    ICON_STORAGE,
    INVITE_COMMAND_HANDLERS,
    INVITE_QUERY_HANDLERS,
    MODERATION_COMMAND_HANDLERS,
    MODERATION_QUERY_HANDLERS,
    ROLE_COMMAND_HANDLERS,
    ROLE_QUERY_HANDLERS,
    SERVER_COMMAND_HANDLERS,
    SERVER_EVENT_HANDLERS,
    SERVER_QUERY_HANDLERS,
    SYSTEM_MESSAGES
} from './application'
import {
    BullMqFileCleanup,
    NoSystemMessagesYet,
    PrismaInviteRepository,
    PrismaMemberRepository,
    PrismaModerationRepository,
    PrismaRoleRepository,
    PrismaServerOwnership,
    PrismaServerRepository,
    ServerIconStorage
} from './infrastructure'
import {
    ChannelLayoutController,
    InvitesController,
    ModerationController,
    RolesController,
    ServersController
} from './presentation'

/**
 * Servers, their categories, channels, roles, members, invites and bans
 * (SRS 4.2, 4.3). The only module that writes these tables. Asks the
 * permissions module what someone may do, and tells it after each commit
 * what changed (D-146). Asks the auth module for the password when a server
 * is handed over (CURRENT_PASSWORD, D-160), and the users module for
 * people's pictures as addresses (USER_DIRECTORY).
 */
@Module({
    // file-cleanup's consumer lives in UploadModule; this module only adds jobs.
    imports: [
        CqrsModule,
        UploadModule,
        PermissionsModule,
        AuthModule,
        UsersModule,
        registerQueues(QUEUES.FILE_CLEANUP)
    ],
    controllers: [ServersController, ChannelLayoutController, InvitesController, RolesController, ModerationController],
    providers: [
        { provide: SERVER_REPOSITORY, useClass: PrismaServerRepository },
        { provide: ICON_STORAGE, useClass: ServerIconStorage },
        { provide: FILE_CLEANUP, useClass: BullMqFileCleanup },
        { provide: INVITE_REPOSITORY, useClass: PrismaInviteRepository },
        { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
        { provide: MEMBER_REPOSITORY, useClass: PrismaMemberRepository },
        { provide: MODERATION_REPOSITORY, useClass: PrismaModerationRepository },
        // RateLimiter comes from the global CacheModule.
        { provide: GUESS_LIMIT, useExisting: RateLimiter },
        { provide: SYSTEM_MESSAGES, useClass: NoSystemMessagesYet },
        ...SERVER_COMMAND_HANDLERS,
        ...SERVER_QUERY_HANDLERS,
        ...CHANNEL_LAYOUT_COMMAND_HANDLERS,
        ...INVITE_COMMAND_HANDLERS,
        ...INVITE_QUERY_HANDLERS,
        ...ROLE_COMMAND_HANDLERS,
        ...ROLE_QUERY_HANDLERS,
        ...MODERATION_COMMAND_HANDLERS,
        ...MODERATION_QUERY_HANDLERS,
        ...SERVER_EVENT_HANDLERS
    ]
})
export class ServersModule {}

/**
 * The auth module's SERVER_OWNERSHIP port, answered from this module's
 * tables (D-160). Global, so AuthModule finds it without importing this
 * module, which imports AuthModule: the code depends one way only, servers
 * on auth. Needs nothing but Prisma (global too). AppModule imports it.
 */
@Global()
@Module({
    providers: [{ provide: SERVER_OWNERSHIP, useClass: PrismaServerOwnership }],
    exports: [SERVER_OWNERSHIP]
})
export class ServerOwnershipModule {}
