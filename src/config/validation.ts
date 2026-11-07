import Joi from 'joi'

/** Values seen in examples and defaults. */
const WEAK_SECRETS = ['admin', 'password', 'secret', 'changeme', '123456', '12345678']
/** Placeholders shipped in .env.example / .env.production (`your_strong_…`). */
const PLACEHOLDER = /^(your[_-]|change[_-]?me)/i

/**
 * A credential that guards something reachable from outside. In production it
 * must be at least 12 characters, and neither a known default nor a
 * placeholder copied from an env template: the app refuses to boot rather than
 * run with admin/admin on an internet-facing dashboard.
 */
const strongSecret = Joi.string()
    .required()
    .min(12)
    .invalid('', ...WEAK_SECRETS)
    .pattern(PLACEHOLDER, { name: 'template placeholder', invert: true })
    .messages({
        'any.invalid': '{{#label}} is empty or a well-known default; set a strong value in production',
        'string.pattern.invert.name': '{{#label}} still holds the {{#name}} from the env template'
    })

/**
 * Only characters a URL carries as they are. docker-compose.prod.yaml puts the
 * database name, user and password into DATABASE_URL unescaped, where an @, /,
 * : or # would be read as part of the address and the app could not connect.
 */
const urlSafe = (schema: Joi.StringSchema) =>
    schema.pattern(/^[A-Za-z0-9._~-]+$/, { name: 'URL-safe characters' }).messages({
        'string.pattern.name':
            '{{#label}} may only contain letters, digits and . _ ~ - in production: docker-compose.prod.yaml puts it into DATABASE_URL as it is (for a password: openssl rand -hex 24)'
    })

/** `strongSecret` when NODE_ENV=production, `base` otherwise. */
const secret = (base: Joi.StringSchema) => base.when('NODE_ENV', { is: 'production', then: strongSecret })

export const validationSchema = Joi.object({
    // app.config.ts
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    PORT: Joi.number().default(3000),
    // Prefix only; URI versioning appends /v1, so 'api/v1' here yields
    // /api/v1/v1/*.
    API_PREFIX: Joi.string().default('api'),
    APP_NAME: Joi.string().default('Test App'),
    // Public base URL of the API: the address Google returns people to, the
    // tokens' issuer, and links to locally stored uploads. Defaults to
    // http://localhost:<PORT> locally; required in production, where that
    // default would break Google sign-in and every upload link.
    BASE_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .when('NODE_ENV', {
            is: 'production',
            then: Joi.required().messages({
                'any.required':
                    '{{#label}} is required in production: Google sign-in returns there, and upload links use it'
            }),
            otherwise: Joi.optional()
        }),
    // Public address of the web app; emails link to its pages. Required in
    // production, where the localhost default would send people nowhere.
    FRONTEND_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .when('NODE_ENV', {
            is: 'production',
            then: Joi.required().messages({
                'any.required': '{{#label}} is required in production: the links in auth emails point there'
            }),
            otherwise: Joi.optional()
        }),
    // Named in the emails where only a person can help (an account deleted
    // by someone else). Optional.
    SUPPORT_EMAIL: Joi.string().email().allow('').optional(),
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().default(5000),
    DELETED_ACCOUNT_RETENTION_DAYS: Joi.number().integer().min(0).default(30),

    // cors.config.ts
    CORS_ORIGINS: Joi.string().default('http://localhost:3001'),
    // The refresh-token cookie is only sent cross-origin with credentials on,
    // and without it every session ends when its first access token expires.
    // Unset means on; production refuses off.
    CORS_CREDENTIALS: Joi.boolean()
        .empty('')
        .default(true)
        .when('NODE_ENV', {
            is: 'production',
            then: Joi.boolean().valid(true).messages({
                'any.only':
                    '{{#label}} must be true in production: without it the browser never sends the refresh cookie, and every session ends after 15 minutes'
            })
        }),

    // auth.config.ts
    // Signs access tokens, and keys the stored hashes of emailed codes. At
    // least 32 characters everywhere: openssl rand -hex 32.
    JWT_SECRET: Joi.string()
        .min(32)
        .required()
        .messages({
            'string.min': '{{#label}} must be at least 32 characters: openssl rand -hex 32',
            'any.required': '{{#label}} is required: openssl rand -hex 32'
        })
        .when('NODE_ENV', {
            is: 'production',
            then: Joi.string()
                .invalid(...WEAK_SECRETS)
                .pattern(PLACEHOLDER, { name: 'template placeholder', invert: true })
                .messages({
                    'string.pattern.invert.name': '{{#label}} still holds the {{#name}} from the env template'
                })
        }),
    JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(3600).empty('').default(900),
    AUTH_SESSION_TTL_DAYS: Joi.number().integer().min(1).max(365).empty('').default(30),
    AUTH_COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').insensitive().empty('').default('lax'),
    // Unset: on in production. Browsers drop a SameSite=None cookie without it.
    AUTH_COOKIE_SECURE: Joi.boolean()
        .empty('')
        .optional()
        .when('AUTH_COOKIE_SAMESITE', {
            is: Joi.string().valid('none').insensitive(),
            then: Joi.boolean().invalid(false).messages({
                'any.invalid': '{{#label}} cannot be false with AUTH_COOKIE_SAMESITE=none: browsers drop such a cookie'
            })
        }),
    // Sign-in with Google: both set turns it on, both empty leaves it off
    // (checked together at the end of the schema).
    GOOGLE_CLIENT_ID: Joi.string().trim().allow('').optional(),
    GOOGLE_CLIENT_SECRET: Joi.string().trim().allow('').optional(),

    // database.config.ts
    DATABASE_URL: Joi.string().required(),
    // The host side of the db port mapping (compose), and what DATABASE_URL
    // uses on this machine.
    DB_PORT: Joi.number().default(5432),
    DB_POOL_MAX: Joi.number().integer().min(1).default(10),
    DB_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
    DB_POOL_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(0).default(10000),
    DB_NAME: Joi.string()
        .required()
        .when('NODE_ENV', { is: 'production', then: urlSafe(Joi.string()) }),
    DB_USERNAME: Joi.string()
        .required()
        .when('NODE_ENV', { is: 'production', then: urlSafe(Joi.string()) }),
    DB_PASSWORD: Joi.string()
        .required()
        .when('NODE_ENV', { is: 'production', then: urlSafe(strongSecret) }),

    // email.config.ts
    // Required in production: signing up and resetting a password work only
    // when the emailed code arrives. Elsewhere the local mail catcher's host
    // is the default.
    EMAIL_HOST: Joi.when('NODE_ENV', {
        is: 'production',
        then: Joi.string().required().messages({
            'any.required': '{{#label}} is required in production: sign-up and password reset email a code',
            'string.empty': '{{#label}} is required in production: sign-up and password reset email a code'
        }),
        otherwise: Joi.string().allow('').default('localhost')
    }),
    EMAIL_PORT: Joi.number().default(587),
    EMAIL_SECURE: Joi.boolean().default(false),
    EMAIL_USER: Joi.string().allow(''),
    EMAIL_PASSWORD: Joi.string().allow(''),
    EMAIL_FROM_NAME: Joi.string().default('Test App'),
    // tlds: false — validate the address shape but not the top-level domain.
    // Joi checks TLDs against the public list by default, which rejects
    // perfectly valid internal senders like noreply@company.internal or the
    // reserved .test domain used for local mail catchers.
    EMAIL_FROM_ADDRESS: Joi.string()
        .email({ tlds: { allow: false } })
        .default('noreply@testapp.com'),

    // redis.config.ts
    REDIS_HOST: Joi.string().default('localhost'),
    REDIS_PORT: Joi.number().default(6379),
    // Optional locally; in production an unauthenticated Redis holds the
    // queues, idempotency locks and auth cache.
    REDIS_PASSWORD: secret(Joi.string().allow('').optional()),

    // cache.config.ts (2-Layer: In-memory + Redis)
    CACHE_TTL: Joi.number().default(3600),
    CACHE_LRU_SIZE: Joi.number().default(500),

    // throttle.config.ts
    THROTTLE_TTL: Joi.number().default(60),
    THROTTLE_LIMIT: Joi.number().default(100),
    THROTTLE_ANONYMOUS_LIMIT: Joi.number().default(300),

    // upload.config.ts
    STORAGE_TYPE: Joi.string().valid('local', 's3').default('local'),
    UPLOAD_DEST: Joi.string().default('./uploads'),
    // Bytes. multer refuses anything but a positive whole number, with a
    // stack trace at startup rather than a message naming this setting.
    MAX_FILE_SIZE: Joi.number().integer().min(1).default(5242880),
    MAX_IMAGE_PIXELS: Joi.number().integer().min(1).default(40000000),
    // sharp's timeout takes whole seconds (rounded up), at most an hour.
    IMAGE_PROCESSING_TIMEOUT_MS: Joi.number().integer().min(1).max(3_600_000).default(15000),
    IMAGE_PROCESSING_CONCURRENCY: Joi.number().integer().min(1).default(2),
    IMAGE_PROCESSING_QUEUE_LIMIT: Joi.number().integer().min(0).default(10),
    AWS_REGION: Joi.string().when('STORAGE_TYPE', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional()
    }),
    AWS_ACCESS_KEY_ID: Joi.string().when('STORAGE_TYPE', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional()
    }),
    AWS_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_TYPE', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional()
    }),
    AWS_S3_BUCKET: Joi.string().when('STORAGE_TYPE', {
        is: 's3',
        then: Joi.required(),
        otherwise: Joi.optional()
    }),

    // S3-compatible storage (RustFS, MinIO, LocalStack, R2, Spaces). Optional in every
    // case — unset means real AWS S3.
    // allow(''): an uncommented but empty template line means "unset".
    AWS_S3_ENDPOINT: Joi.string().uri().allow('').optional(),
    AWS_S3_PUBLIC_ENDPOINT: Joi.string().uri().allow('').optional(),
    AWS_S3_FORCE_PATH_STYLE: Joi.boolean().allow('').optional(),

    // pino.config.ts
    LOG_LEVEL: Joi.string().default('info'),
    // Unset picks json in containers/production, pretty in a terminal
    LOG_FORMAT: Joi.string().valid('json', 'pretty').optional(),
    // Read by compose and deploy.sh for which monitoring runs; here only for
    // the log format: with `off` (development only) nothing parses the JSON.
    MONITORING: Joi.string().valid('local', 'grafana-cloud', 'off').default('local'),

    // Basic auth for /admin/queues, and for /api-docs in production. Both are
    // mounted outside the API guards.
    BULL_BOARD_USER: Joi.string().default('admin'),
    BULL_BOARD_PASSWORD: secret(Joi.string().default('admin')),

    // timeout.config.ts
    REQUEST_TIMEOUT_MS: Joi.number().default(30000),

    // Read by docker compose, not the app: where Alertmanager sends alerts
    // (docs/alerts.md). Checked here too, so that a production deploy with the
    // template's placeholder stops instead of every alert failing to arrive.
    ALERT_WEBHOOK_URL: Joi.when('NODE_ENV', {
        is: 'production',
        then: Joi.string()
            .required()
            .uri({ scheme: ['https'] })
            .pattern(/your[_-]/i, { name: 'template placeholder', invert: true })
            .messages({
                'any.required': '{{#label}} is required in production: alerts have nowhere to go without it',
                'string.empty': '{{#label}} is required in production: alerts have nowhere to go without it',
                'string.pattern.invert.name': '{{#label}} still holds the {{#name}} from the env template'
            }),
        otherwise: Joi.string().allow('').optional()
    }),

    // sentry.config.ts: error tracking, off when empty (docs/error-tracking.md).
    // Read before this schema runs (src/instrument.ts), so a bad value is
    // reported here but the SDK has already been given it.
    SENTRY_DSN: Joi.string()
        .allow('')
        .optional()
        .uri({ scheme: ['https', 'http'] })
        .pattern(/^https?:\/\/[^@/\s]+@[^/\s]+\/\S+$/, { name: 'DSN shape (https://<key>@<host>/<project>)' })
        .pattern(/your[_-]/i, { name: 'template placeholder', invert: true })
        .messages({
            'string.pattern.name': '{{#label}} is not a DSN: expected the {{#name}} from the project settings',
            'string.pattern.invert.name': '{{#label}} still holds the {{#name}} from the env template'
        }),
    SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0),
    // Set by docker-compose.prod.yaml to the release deploy.sh is deploying,
    // not in the env file.
    SENTRY_RELEASE: Joi.string().allow('').optional()
})
    // One key without the other is half-configured: it would fail at the
    // first request rather than at boot.
    .custom((env: Record<string, unknown>, helpers) => {
        for (const [a, b, what] of PAIRED_KEYS) {
            if (Boolean(env[a]) === Boolean(env[b])) continue
            const [present, missing] = env[a] ? [a, b] : [b, a]
            return helpers.message({
                custom: `"${missing}" is required when "${present}" is set: ${what} needs both (or neither, to leave it off)`
            })
        }
        return env
    })

/** Keys that turn a feature on together. */
const PAIRED_KEYS: [string, string, string][] = [['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'Google sign-in']]
