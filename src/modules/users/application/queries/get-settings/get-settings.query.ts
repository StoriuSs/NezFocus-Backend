/** The signed-in user's settings (GET /users/me/settings). */
export class GetSettingsQuery {
    constructor(public readonly userId: string) {}
}
