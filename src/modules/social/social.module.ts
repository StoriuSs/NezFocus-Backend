import { Module } from '@nestjs/common'

/**
 * Friends, blocks, direct messages and one-to-one calls (SRS 4.9,
 * ARCHITECTURE 9). So far its tables and their checks (M6 L1,
 * social.prisma, D-242); friends and blocks come with L2, conversations with
 * L3, calls with L4.
 */
@Module({})
export class SocialModule {}
