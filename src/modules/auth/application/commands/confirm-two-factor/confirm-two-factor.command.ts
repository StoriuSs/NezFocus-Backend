export class ConfirmTwoFactorCommand {
    constructor(
        public readonly userId: string,
        public readonly code: string
    ) {}
}
