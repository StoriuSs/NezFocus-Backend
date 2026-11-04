import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { ResolveAvatarUrlQuery } from './resolve-avatar-url.query'
import { STORAGE, StoragePort } from '../../ports'

/**
 * A stored avatar key, as a URL the client can fetch. Through getReadUrl, not
 * a public URL: a private S3 bucket gives a presigned one.
 */
@QueryHandler(ResolveAvatarUrlQuery)
export class ResolveAvatarUrlHandler implements IQueryHandler<ResolveAvatarUrlQuery> {
    constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

    async execute({ key }: ResolveAvatarUrlQuery): Promise<string | null> {
        return key ? this.storage.getReadUrl(key) : null
    }
}
