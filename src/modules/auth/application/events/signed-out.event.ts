/**
 * Domain Event: Signed Out
 *
 * Published when someone signs out (the Đăng xuất button, LogoutCommand),
 * after SessionsEndedEvent for that session, and only then: revoking another
 * session, a password change or reset, a refresh token used twice, or a
 * deleted account end sessions without the person leaving the app here.
 * The study module ends their Solo, which belongs to no one device (D-229).
 */
export class SignedOutEvent {
    constructor(readonly userId: string) {}
}
