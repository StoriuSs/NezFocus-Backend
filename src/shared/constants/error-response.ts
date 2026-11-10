export const ERROR_TYPES = {
    // Validation errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    // An Idempotency-Key reused with a different request body.
    IDEMPOTENCY_KEY_MISMATCH: 'IDEMPOTENCY_KEY_MISMATCH',

    // Auth errors
    AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
    AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
    AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
    AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
    AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
    AUTH_TOKEN_REVOKED: 'AUTH_TOKEN_REVOKED',
    AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
    AUTH_REFRESH_FAILED: 'AUTH_REFRESH_FAILED',
    AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
    // A verification or reset code that is wrong; one that has expired or
    // used up its attempts, and needs a new one sent.
    AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
    AUTH_CODE_EXPIRED: 'AUTH_CODE_EXPIRED',
    // A password the policy refuses; the message names the rule.
    AUTH_PASSWORD_REJECTED: 'AUTH_PASSWORD_REJECTED',
    // The current password, given to change it, is wrong. Not a 401: the
    // session is fine, and clients sign out on any 401.
    AUTH_CURRENT_PASSWORD_INVALID: 'AUTH_CURRENT_PASSWORD_INVALID',
    // A signed-in route used before the "complete your account" step (D-61);
    // that step sent again once it is done. Named as in SRS section 8.
    ACCOUNT_INCOMPLETE: 'ACCOUNT_INCOMPLETE',
    ACCOUNT_ALREADY_COMPLETE: 'ACCOUNT_ALREADY_COMPLETE',
    // A signed-in route used by an account waiting to be deleted (D-141).
    ACCOUNT_PENDING_DELETION: 'ACCOUNT_PENDING_DELETION',
    // Deleting an account that owns servers with other members (D-76).
    OWNERSHIP_TRANSFER_REQUIRED: 'OWNERSHIP_TRANSFER_REQUIRED',

    // User errors
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USERNAME_CONFLICT: 'USERNAME_CONFLICT',

    // Server errors (SRS appendix A)
    // A dead invite: expired, used up, revoked, or its server deleted.
    INVITE_INVALID: 'INVITE_INVALID',
    // Already in 100 servers (REQ-SRV-01).
    MAX_SERVERS_REACHED: 'MAX_SERVERS_REACHED',
    OWNER_CANNOT_LEAVE: 'OWNER_CANNOT_LEAVE',
    // Acting on a role or a member ranked the same as or above oneself.
    ROLE_HIERARCHY_VIOLATION: 'ROLE_HIERARCHY_VIOLATION',
    BANNED_FROM_SERVER: 'BANNED_FROM_SERVER',
    // Timed out; the response says until when.
    MEMBER_TIMED_OUT: 'MEMBER_TIMED_OUT',

    // Upload errors
    UPLOAD_FILE_TOO_LARGE: 'UPLOAD_FILE_TOO_LARGE',
    UPLOAD_INVALID_TYPE: 'UPLOAD_INVALID_TYPE',
    UPLOAD_INVALID_FILE: 'UPLOAD_INVALID_FILE',
    UPLOAD_DELETE_FAILED: 'UPLOAD_DELETE_FAILED',
    UPLOAD_FILE_NOT_FOUND: 'UPLOAD_FILE_NOT_FOUND',
    UPLOAD_FAILED: 'UPLOAD_FAILED',
    IMAGE_PROCESSING_FAILED: 'IMAGE_PROCESSING_FAILED',

    // Rate limiting errors
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

    // Generic errors
    GENERIC: 'GENERIC_ERROR',
    BAD_REQUEST: 'BAD_REQUEST_ERROR',
    NOT_FOUND: 'NOT_FOUND_ERROR',
    // Lacking a permission in a server (appendix B). A resource the caller may
    // not even know about is NOT_FOUND instead (NFR-SEC-05).
    FORBIDDEN: 'FORBIDDEN_ERROR',
    REQUEST_TIMEOUT: 'REQUEST_TIMEOUT_ERROR',
    CONFLICT: 'CONFLICT_ERROR',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE_ERROR',
    UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE_ERROR',
    THROTTLE: 'THROTTLE_ERROR'
}

/*
 * Retired codes, never to be reused: a code is what a log search or a support
 * ticket quotes, so one number must keep one meaning. 400001 USER_VALIDATION,
 * 400100 CODE_VALIDATION_ERROR, 400101 SESSION_EXPIRED, 401002
 * AUTH_USER_NOT_FOUND, 401007 AUTH_LOGIN_FAILED, 403001 CORS_ERROR, 409001
 * AUTH_EMAIL_EXISTS, 422002 IMAGE_INVALID, 500001 EMAIL_SEND_FAILED, 503001
 * AUTH_PROVIDER_UNAVAILABLE (Keycloak). Two-step sign-in and Turnstile:
 * 400105 AUTH_TWO_FACTOR_CODE_INVALID, 400106 AUTH_CAPTCHA_REQUIRED, 400107
 * AUTH_CAPTCHA_FAILED, 401009 AUTH_TWO_FACTOR_CHALLENGE_EXPIRED, 403005
 * AUTH_TWO_FACTOR_REQUIRED, 409002 AUTH_TWO_FACTOR_ALREADY_ON, 409003
 * AUTH_TWO_FACTOR_NOT_ON, 503002 AUTH_CAPTCHA_UNAVAILABLE, 503003
 * AUTH_TWO_FACTOR_UNAVAILABLE. Sign-up before codes by email, and a first
 * password by code (M0 L6): 403002 AUTH_EMAIL_NOT_VERIFIED, 409004
 * AUTH_PASSWORD_ALREADY_SET, 409005 AUTH_USE_PASSWORD. A username set on its
 * own, once (M0 L7): 400200 USERNAME_ALREADY_SET. Deleting an account with an
 * optional proof, now a required password (Kiểm 3): 400108
 * AUTH_CONFIRMATION_REQUIRED. Servers' codes, numbered in users' hundred
 * before servers took x3xx (D-158): 403200 MAX_SERVERS_REACHED, 403201
 * OWNER_CANNOT_LEAVE, 403202 ROLE_HIERARCHY_VIOLATION, 403203
 * BANNED_FROM_SERVER, 403204 MEMBER_TIMED_OUT, 410200 INVITE_INVALID.
 */
export const ERROR_CODES = {
    // Validation error codes (400, 422)
    BAD_REQUEST: '400000',
    VALIDATION_ERROR: '422000',
    IDEMPOTENCY_KEY_MISMATCH: '422003',

    // Auth error codes (401)
    AUTH_UNAUTHORIZED: '401000',
    AUTH_INVALID_CREDENTIALS: '401001',
    AUTH_TOKEN_MISSING: '401003',
    AUTH_TOKEN_EXPIRED: '401004',
    AUTH_TOKEN_INVALID: '401005',
    AUTH_TOKEN_REVOKED: '401006',
    AUTH_REFRESH_FAILED: '401008',

    // Auth codes and passwords (400, 422)
    AUTH_CODE_INVALID: '400102',
    AUTH_CODE_EXPIRED: '400103',
    AUTH_CURRENT_PASSWORD_INVALID: '400104',
    AUTH_PASSWORD_REJECTED: '422004',

    // Forbidden error codes (403)
    AUTH_ACCOUNT_DISABLED: '403003',
    AUTH_FORBIDDEN: '403004',
    ACCOUNT_INCOMPLETE: '403100',
    ACCOUNT_PENDING_DELETION: '403101',
    MAX_SERVERS_REACHED: '403300',
    OWNER_CANNOT_LEAVE: '403301',
    ROLE_HIERARCHY_VIOLATION: '403302',
    BANNED_FROM_SERVER: '403303',
    MEMBER_TIMED_OUT: '403304',

    // Gone (410)
    INVITE_INVALID: '410300',

    // Not found error codes (404)
    USER_NOT_FOUND: '404001',

    // Conflict error codes (409)
    ACCOUNT_ALREADY_COMPLETE: '409100',
    OWNERSHIP_TRANSFER_REQUIRED: '409101',
    USERNAME_CONFLICT: '409200',

    // Upload error codes (400, 404, 413, 415, 422, 500)
    UPLOAD_INVALID_FILE: '400002',
    UPLOAD_FILE_NOT_FOUND: '404002',
    UPLOAD_FILE_TOO_LARGE: '413001',
    UPLOAD_INVALID_TYPE: '415001',
    IMAGE_PROCESSING_FAILED: '422001',
    UPLOAD_DELETE_FAILED: '500002',
    UPLOAD_FAILED: '500003',

    // Rate limiting error codes (429)
    RATE_LIMIT_EXCEEDED: '429001',

    // Generic status-derived codes, used when an exception carries no code of
    // its own (e.g. a bare NotFoundException from a framework internal).
    FORBIDDEN: '403000',
    NOT_FOUND: '404000',
    REQUEST_TIMEOUT: '408000',
    CONFLICT: '409000',
    PAYLOAD_TOO_LARGE: '413000',
    UNSUPPORTED_MEDIA_TYPE: '415000',
    SERVICE_UNAVAILABLE: '503000',

    // Server error codes (500)
    GENERIC: '500000'
}
