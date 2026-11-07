import { SessionClient } from '@/modules/auth/domain'

export class RefreshCommand {
    /**
     * @param refreshToken the cookie's value, if the request carried one
     * @param client where the request came from: recorded on the session (D-138)
     */
    constructor(
        public readonly refreshToken: string | undefined,
        public readonly client?: SessionClient
    ) {}
}
