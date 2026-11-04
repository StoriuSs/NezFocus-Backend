import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { UploadModule } from '@/shared/infrastructure/storage/upload.module'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'

// Domain
import { USER_REPOSITORY } from './domain'

// Application
import {
    STORAGE,
    BACKGROUND_JOBS,
    USER_DIRECTORY,
    UpdateProfileHandler,
    SetUsernameHandler,
    UploadAvatarHandler,
    DeleteAccountHandler,
    SweepDeletedAccountsHandler,
    CheckUsernameHandler,
    ResolveAvatarUrlHandler,
    CleanupOldAvatarHandler,
    CleanupAccountAvatarHandler
} from './application'

// Infrastructure
import { BullMqBackgroundJobs, PrismaUserRepository, UploadStorage, UserDirectory } from './infrastructure'

// Presentation (Inbound Adapters)
import { UsersController } from './presentation'

const CommandHandlers = [
    UpdateProfileHandler,
    SetUsernameHandler,
    UploadAvatarHandler,
    DeleteAccountHandler,
    SweepDeletedAccountsHandler
]

const QueryHandlers = [CheckUsernameHandler, ResolveAvatarUrlHandler]

const EventHandlers = [CleanupOldAvatarHandler, CleanupAccountAvatarHandler]

@Module({
    // file-cleanup's consumer lives in UploadModule; this module only adds jobs.
    imports: [CqrsModule, UploadModule, registerQueues(QUEUES.FILE_CLEANUP)],
    controllers: [UsersController],
    providers: [
        // Port → Adapter bindings (Hexagonal Architecture wiring)
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: STORAGE, useClass: UploadStorage },
        { provide: BACKGROUND_JOBS, useClass: BullMqBackgroundJobs },
        // Published for other modules: what the auth module needs from users.
        { provide: USER_DIRECTORY, useClass: UserDirectory },

        // CQRS Handlers
        ...CommandHandlers,
        ...QueryHandlers,
        ...EventHandlers
    ],
    exports: [USER_DIRECTORY]
})
export class UsersModule {}
