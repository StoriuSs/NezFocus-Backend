/** Remove a user's avatar (D-72): they go back to their initial. */
export class RemoveAvatarCommand {
    constructor(public readonly userId: string) {}
}
