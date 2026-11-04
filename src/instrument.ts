// Error tracking starts before anything else is imported: the SDK hooks into
// modules (http, express, pg) as they load. See docs/error-tracking.md.
import './config/load-env'
import * as Sentry from '@sentry/nestjs'
import { sentryOptions } from './config/sentry.config'

const options = sentryOptions()
if (options) Sentry.init(options)
