import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** A person as others see them; nulls for an account deleted or waiting to be (D-182): the client says "Tài khoản đã bị xóa". */
export class SocialPersonResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsOptional()
    @IsString()
    username: string | null

    @Expose()
    @IsOptional()
    @IsString()
    displayName: string | null

    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null
}
