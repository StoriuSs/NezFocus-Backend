import { Cycle } from '../../../domain'

/**
 * Start a Solo (REQ-STUDY-05, `POST /me/solo-session`): with the cycle
 * sent, or the last Solo's when no part of one is (D-103).
 */
export class StartSoloSessionCommand {
    constructor(
        readonly userId: string,
        readonly cycle: Partial<Cycle>
    ) {}
}

/** End a person's Solo, if they have one, because they pressed Đăng xuất (D-229). */
export class EndSignedOutSoloCommand {
    constructor(readonly userId: string) {}
}
