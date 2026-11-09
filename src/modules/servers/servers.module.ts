import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { UploadModule } from '@/shared/infrastructure/storage/upload.module'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import {
    CreateServerHandler,
    FILE_CLEANUP,
    ICON_STORAGE,
    ListMyServersHandler,
    RemoveServerIconHandler,
    SERVER_REPOSITORY,
    UploadServerIconHandler
} from './application'
import { BullMqFileCleanup, PrismaServerRepository, ServerIconStorage } from './infrastructure'
import { ServersController } from './presentation'

/**
 * Servers, their categories, channels, roles, members, invites and bans
 * (SRS 4.2, 4.3). The only module that writes these tables. Asks the
 * permissions module what someone may do, and tells it after each commit
 * what changed (D-146).
 */
@Module({
    // file-cleanup's consumer lives in UploadModule; this module only adds jobs.
    imports: [CqrsModule, UploadModule, PermissionsModule, registerQueues(QUEUES.FILE_CLEANUP)],
    controllers: [ServersController],
    providers: [
        { provide: SERVER_REPOSITORY, useClass: PrismaServerRepository },
        { provide: ICON_STORAGE, useClass: ServerIconStorage },
        { provide: FILE_CLEANUP, useClass: BullMqFileCleanup },
        CreateServerHandler,
        UploadServerIconHandler,
        RemoveServerIconHandler,
        ListMyServersHandler
    ]
})
export class ServersModule {}
