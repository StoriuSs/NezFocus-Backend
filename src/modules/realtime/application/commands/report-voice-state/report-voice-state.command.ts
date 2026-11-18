/** A tab in a voice room says what its microphone and camera are (D-206): `voice.self_state` over its socket. */
export class ReportVoiceStateCommand {
    constructor(
        public readonly userId: string,
        public readonly micOn: boolean,
        public readonly cameraOn: boolean
    ) {}
}
