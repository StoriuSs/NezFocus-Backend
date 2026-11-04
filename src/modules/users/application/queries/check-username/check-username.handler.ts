import { QueryHandler, IQueryHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { CheckUsernameQuery } from './check-username.query'
import { UserRepositoryPort, USER_REPOSITORY, normaliseUsername } from '@/modules/users/domain'

@QueryHandler(CheckUsernameQuery)
export class CheckUsernameHandler implements IQueryHandler<CheckUsernameQuery> {
    constructor(@Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort) {}

    async execute(query: CheckUsernameQuery): Promise<boolean> {
        // Normalise here too: the availability check and the claim must agree,
        // or a name can read as free and then fail on submit.
        const existing = await this.userRepo.findByUsername(normaliseUsername(query.username))
        return !existing
    }
}
