/**
 * What the media server says happened in a room (its webhooks, D-210), in
 * this module's terms. Only what voice acts on has a kind of its own.
 */
export type MediaEvent =
    | {
          /** The media server's id of the event: the same event sent again has the same id. */
          id: string
          kind: 'joined' | 'left'
          /** The room's name at the media server (voice:<channelId>). */
          room: string
          /** The user id the join token was issued for. */
          identity: string
          /** The media server's id of the connection. */
          participantSid: string
          /** When the connection joined. */
          joinedAt: Date
      }
    | {
          id: string
          /** A screen (screen_share track) published or unpublished; its sound is no screen. */
          kind: 'share_started' | 'share_stopped'
          room: string
          identity: string
          participantSid: string
          /** The media server's id of the screen's track. */
          trackSid: string
      }
    | { id: string; kind: 'other' }

/**
 * Media Events Port — the webhooks of the media server (LiveKit, ARCHITECTURE
 * 4), checked and read. Sent to a public route, so nothing is taken from one
 * before its signature is checked.
 */
export interface MediaEventsPort {
    /**
     * The event `body` carries, once `authorization` proves the media server
     * signed exactly this body.
     * @throws MediaEventRejectedError when it does not
     */
    read(body: string, authorization: string | undefined): Promise<MediaEvent>
}

export const MEDIA_EVENTS = Symbol('MediaEventsPort')
