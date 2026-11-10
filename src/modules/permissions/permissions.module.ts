import { Module } from '@nestjs/common'
import { ACCESS_SOURCE, PERMISSION_CACHE, PERMISSION_CHECKER } from './application'
import { PrismaAccessSource, RedisPermissionChecker } from './infrastructure'

/**
 * Works out what a member may do in a server (REQ-ROLE-05). Has no routes of
 * its own: the servers module, and later messaging, voice, study and tasks,
 * ask it through PERMISSION_CHECKER and tell it about changes through
 * PERMISSION_CACHE.
 */
@Module({
    providers: [
        { provide: ACCESS_SOURCE, useClass: PrismaAccessSource },
        RedisPermissionChecker,
        { provide: PERMISSION_CHECKER, useExisting: RedisPermissionChecker },
        { provide: PERMISSION_CACHE, useExisting: RedisPermissionChecker }
    ],
    exports: [PERMISSION_CHECKER, PERMISSION_CACHE]
})
export class PermissionsModule {}
