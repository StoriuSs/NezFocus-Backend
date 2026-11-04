/*
 * What goes wrong when signing in, in domain terms. The shared
 * DomainExceptionFilter turns each into the API's error envelope.
 *
 * The messages reach the client, so they say nothing an attacker could use:
 * a wrong password and an unknown address are the same error, and a wrong
 * code does not say whether the address has an account.
 */

export * from './account-deletion.errors'
export * from './captcha.errors'
export * from './codes.errors'
export * from './oauth.errors'
export * from './password.errors'
export * from './rate-limit.errors'
export * from './session.errors'
export * from './sign-in.errors'
export * from './two-factor.errors'
