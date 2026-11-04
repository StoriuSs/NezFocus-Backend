/** Two-step sign-in's settings: the name authenticator apps show. */
export interface TwoFactorSettings {
    issuer: string
}

export const TWO_FACTOR_SETTINGS = Symbol('TwoFactorSettings')
