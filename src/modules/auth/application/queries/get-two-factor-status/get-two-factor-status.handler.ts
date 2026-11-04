import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Inject } from '@nestjs/common'
import { GetTwoFactorStatusQuery } from './get-two-factor-status.query'
import { TWO_FACTOR_REPOSITORY, TwoFactorRepositoryPort } from '@/modules/auth/domain'

export interface TwoFactorStatus {
    enabled: boolean
    /** Unused recovery codes; 0 when it is off. */
    recoveryCodesLeft: number
}

@QueryHandler(GetTwoFactorStatusQuery)
export class GetTwoFactorStatusHandler implements IQueryHandler<GetTwoFactorStatusQuery> {
    constructor(@Inject(TWO_FACTOR_REPOSITORY) private readonly twoFactors: TwoFactorRepositoryPort) {}

    async execute({ userId }: GetTwoFactorStatusQuery): Promise<TwoFactorStatus> {
        const record = await this.twoFactors.find(userId)
        if (!record?.confirmed) return { enabled: false, recoveryCodesLeft: 0 }
        return { enabled: true, recoveryCodesLeft: await this.twoFactors.countUnusedRecoveryCodes(userId) }
    }
}
