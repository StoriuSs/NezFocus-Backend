import { Controller } from '@nestjs/common'
import { PrometheusController } from '@willsoto/nestjs-prometheus'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public, SkipRateLimit } from '@/shared/presentation/decorators'
import { RawResponse } from '@/shared/presentation/decorators/raw-response.decorator'
import { ExcludeFromMetrics, SkipSuccessLog } from '@/shared/presentation/decorators/observability.decorator'

/**
 * The Prometheus scrape endpoint (`/api/v1/metrics`), with its exemptions
 * declared on the route instead of matched against the URL.
 *
 * Public and unthrottled so Prometheus can scrape it from inside the Docker
 * network. That makes the edge its only protection: nginx must refuse this
 * path to the public internet (see nginx/app.conf.template).
 *
 * The path is set here, not through the module's `path` option: the library
 * only writes that option onto its own default controller.
 */
@Controller('metrics')
@ApiExcludeController() // Prometheus text format, not part of the API
@Public()
@SkipRateLimit()
@RawResponse()
@ExcludeFromMetrics()
@SkipSuccessLog()
export class MetricsController extends PrometheusController {}
