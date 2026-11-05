/**
 * The Redis keys of the session check (redis-session-cache.adapter.ts). In a file of
 * their own, with no imports, so the command-line scripts that change a user
 * (src/bootstrap/user-roles.ts) name the same key the app reads.
 */
export const sessionKey = (id: string) => `auth:session:${id}`
export const userKey = (id: string) => `auth:user:${id}`
export const replacementKey = (tokenHash: string) => `auth:replaced:${tokenHash}`
export const oauthAttemptKey = (state: string) => `auth:oauth:${state}`
