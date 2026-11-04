import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common'
import { toCamelCaseKeys } from '@/shared/utils/case-keys.util'

@Injectable()
export class SnakeToCamelPipe implements PipeTransform {
    transform(value: unknown, _metadata: ArgumentMetadata): unknown {
        return toCamelCaseKeys(value)
    }
}
