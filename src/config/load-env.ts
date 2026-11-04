import path from 'path'
import { config } from 'dotenv'

/**
 * Loads `.env.<NODE_ENV>` (default development) into process.env, without
 * overriding variables that are already set.
 *
 * ConfigModule loads the same file, but only when AppModule is initialised.
 * A few values are read at import time, before that — the log level and the
 * upload limits used in decorators — so running the app on the host ignored
 * LOG_LEVEL, MAX_FILE_SIZE and friends from .env.development and used the
 * defaults. Import this first wherever that matters. In containers the
 * variables come from the environment and no file exists, so it does nothing.
 */
config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`), quiet: true })
