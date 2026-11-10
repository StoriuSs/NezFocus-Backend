import { Expose } from 'class-transformer'
import { IsBoolean, IsIn, IsString } from 'class-validator'

/** The channel the link names, when someone joining would see it (D-150). */
export class InviteTargetResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    @Expose()
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    @Expose()
    @IsBoolean()
    isStudyRoom: boolean
}
