import { ServerTemplateName } from '../../../domain'

export class CreateServerCommand {
    constructor(
        public readonly userId: string,
        /** Already composed and trimmed. */
        public readonly name: string,
        public readonly template: ServerTemplateName
    ) {}
}
