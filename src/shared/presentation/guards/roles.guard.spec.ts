import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Roles } from '@/shared/presentation/decorators'
import { RolesGuard } from './roles.guard'

class AdminController {
    @Roles('admin')
    sweep() {}
}

/** A request for AdminController.sweep, made by a user with these roles. */
const requestBy = (roles: string[]) =>
    ({
        getHandler: () => AdminController.prototype.sweep,
        getClass: () => AdminController,
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1', roles } }) })
    }) as unknown as ExecutionContext

describe('RolesGuard', () => {
    it('refuses a user without the role the route asks for, and lets one with it through', () => {
        const guard = new RolesGuard(new Reflector())
        expect(guard.canActivate(requestBy(['user']))).toBe(false)
        expect(guard.canActivate(requestBy(['user', 'admin']))).toBe(true)
    })
})
