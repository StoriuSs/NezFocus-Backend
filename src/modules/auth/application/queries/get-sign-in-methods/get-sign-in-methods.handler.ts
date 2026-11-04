import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { GetSignInMethodsQuery } from './get-sign-in-methods.query'
import { SignInMethods, SignInMethodsOf } from '../../services/sign-in-methods'

@QueryHandler(GetSignInMethodsQuery)
export class GetSignInMethodsHandler implements IQueryHandler<GetSignInMethodsQuery> {
    constructor(private readonly methods: SignInMethods) {}

    execute({ userId }: GetSignInMethodsQuery): Promise<SignInMethodsOf> {
        return this.methods.of(userId)
    }
}
