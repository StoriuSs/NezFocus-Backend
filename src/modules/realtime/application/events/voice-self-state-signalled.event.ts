/**
 * A tab says what its microphone and camera are in the voice room its person
 * is in (D-206): sent by the client over its socket, handed on as it came.
 * Who is in which room is the voice module's: it writes the icons and tells
 * the room's viewers.
 */
export class VoiceSelfStateSignalledEvent {
    constructor(
        public readonly userId: string,
        public readonly micOn: boolean,
        public readonly cameraOn: boolean
    ) {}
}
