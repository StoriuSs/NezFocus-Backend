/**
 * How long a join token can be used to connect (D-210). It works for the
 * first connection only: once in, LiveKit gives the browser fresh ones
 * itself, so this is how long a browser has to use it, not how long the
 * person may stay.
 */
export const JOIN_TOKEN_TTL_SECONDS = 600
