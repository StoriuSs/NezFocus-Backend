export class LogoutCommand {
    /** @param refreshToken the cookie's value, if the request carried one */
    constructor(public readonly refreshToken: string | undefined) {}
}
