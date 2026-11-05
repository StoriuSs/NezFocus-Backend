import { AccountDeletionController } from './account-deletion.controller'
import { AuthController } from './auth.controller'
import { OAuthController } from './oauth.controller'
import { PasswordController } from './password.controller'

export { AccountDeletionController, AuthController, OAuthController, PasswordController }
export { AuthCookies } from './auth-cookies'

/**
 * Every controller of the module, in the order Nest registers their routes.
 * Express tries routes in that order and takes the first that matches, so
 * OAuthController stays last: its `GET auth/:provider` matches any
 * `GET auth/<word>`, and placed earlier it would answer `GET auth/options`
 * and `auth/sign-in-methods` itself, as a sign-in with a provider called
 * "options": a 404.
 * test/e2e/auth-routes.e2e-spec.ts fails if it moves.
 */
export const AUTH_CONTROLLERS = [AuthController, PasswordController, AccountDeletionController, OAuthController]
