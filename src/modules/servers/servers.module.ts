import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { UploadModule } from '@/shared/infrastructure/storage/upload.module'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import {
    CHANNEL_LAYOUT_HANDLERS,
    CreateServerHandler,
    FILE_CLEANUP,
    GUESS_LIMIT,
    ICON_STORAGE,
    INVITE_HANDLERS,
    INVITE_REPOSITORY,
    ListMyServersHandler,
    MEMBER_DIRECTORY,
    RemoveServerIconHandler,
    ROLE_HANDLERS,
    ROLE_REPOSITORY,
    SERVER_REPOSITORY,
    SYSTEM_MESSAGES,
    UpdateServerHandler,
    UploadServerIconHandler
} from './application'
import {
    BullMqFileCleanup,
    NoSystemMessagesYet,
    PrismaInviteRepository,
    PrismaMemberDirectory,
    PrismaRoleRepository,
    PrismaServerRepository,
    ServerIconStorage
} from './infrastructure'
import { ChannelLayoutController, InvitesController, RolesController, ServersController } from './presentation'

/**
 * Servers, their categories, channels, roles, members, invites and bans
 * (SRS 4.2, 4.3). The only module that writes these tables. Asks the
 * permissions module what someone may do, and tells it after each commit
 * what changed (D-146).
 */
@Module({
    // file-cleanup's consumer lives in UploadModule; this module only adds jobs.
    imports: [CqrsModule, UploadModule, PermissionsModule, registerQueues(QUEUES.FILE_CLEANUP)],
    controllers: [ServersController, ChannelLayoutController, InvitesController, RolesController],
    providers: [
        { provide: SERVER_REPOSITORY, useClass: PrismaServerRepository },
        { provide: ICON_STORAGE, useClass: ServerIconStorage },
        { provide: FILE_CLEANUP, useClass: BullMqFileCleanup },
        { provide: INVITE_REPOSITORY, useClass: PrismaInviteRepository },
        { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
        { provide: MEMBER_DIRECTORY, useClass: PrismaMemberDirectory },
        // RateLimiter comes from the global CacheModule.
        { provide: GUESS_LIMIT, useExisting: RateLimiter },
        { provide: SYSTEM_MESSAGES, useClass: NoSystemMessagesYet },
        CreateServerHandler,
        UploadServerIconHandler,
        RemoveServerIconHandler,
        UpdateServerHandler,
        ListMyServersHandler,
        ...CHANNEL_LAYOUT_HANDLERS,
        ...INVITE_HANDLERS,
        ...ROLE_HANDLERS
    ]
})
export class ServersModule {}
