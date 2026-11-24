import { Controller, Get, Param, Query } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { MESSAGES } from '@/shared/constants'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, createResponse, ServiceResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import { GetPersonProfileQuery, LookUpPersonQuery, PersonProfileView } from '../../application'
import { LookUpPersonQueryDto, PersonProfileResponseDto, UserIdParamsDto } from './dto'

/**
 * People outside a server (SRS 5.1, D-109, D-110, D-243): looking someone up
 * by username before asking them, and a profile with where we stand and the
 * servers we share. Under `users/` beside the users module's own routes,
 * none of which is `users/:id`.
 */
@ApiTags('social')
@ApiBearerAuth('bearer')
@Controller({ path: 'users', version: '1' })
export class PeopleController {
    constructor(private readonly queryBus: QueryBus) {}

    /**
     * Someone's card by username (D-110), 30 lookups a minute
     * (RATE_LIMIT_EXCEEDED with `reason: user_lookup`). Not found: no such
     * username, oneself, an account deleted or waiting to be. One who
     * blocked me is found as anyone (REQ-SOCIAL-01).
     */
    @Get('lookup')
    @ApiEnvelopeResponse(PersonProfileResponseDto)
    async lookUp(
        @CurrentUser() user: AuthenticatedUser,
        @Query() { username }: LookUpPersonQueryDto
    ): Promise<ServiceResponse<PersonProfileResponseDto>> {
        const profile: PersonProfileView = await this.queryBus.execute(new LookUpPersonQuery(user.id, username))
        return createResponse(MESSAGES.SOCIAL.PERSON_FOUND, validateAndTransform(PersonProfileResponseDto, profile))
    }

    /** Someone's profile (D-109, D-111); an account waiting to be deleted shows as deleted (D-182). */
    @Get(':userId/profile')
    @ApiEnvelopeResponse(PersonProfileResponseDto)
    async profile(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { userId }: UserIdParamsDto
    ): Promise<ServiceResponse<PersonProfileResponseDto>> {
        const profile: PersonProfileView = await this.queryBus.execute(new GetPersonProfileQuery(user.id, userId))
        return createResponse(MESSAGES.SOCIAL.PROFILE_FETCHED, validateAndTransform(PersonProfileResponseDto, profile))
    }
}
