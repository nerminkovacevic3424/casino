import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GAME_IDS, type GameId } from '@casino/shared-types';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SpinDto {
  @ApiProperty({
    description:
      'Total stake in minor units; must be one of the game’s bet options',
  })
  @IsInt()
  @IsPositive()
  totalBet!: number;
}

export class RoundQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: GAME_IDS })
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: GameId;
}

export class RotateSeedDto {
  @ApiPropertyOptional({
    description:
      'New client seed (1-64 printable ASCII, no spaces). Random if omitted.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'clientSeed must be printable ASCII without spaces',
  })
  clientSeed?: string;
}

export class FairnessInfoDto {
  @ApiProperty() serverSeedHash!: string;
  @ApiProperty() clientSeed!: string;
  @ApiProperty() nonce!: number;
}

export class SpinResponseDto {
  @ApiProperty() roundId!: string;
  @ApiProperty({ enum: GAME_IDS }) gameId!: string;
  @ApiProperty() stake!: number;
  @ApiProperty() payout!: number;
  @ApiProperty() balance!: number;
  @ApiProperty({
    description: 'Full SlotRoundResult from @casino/game-engine',
    type: Object,
  })
  result!: object;
  @ApiProperty({ type: FairnessInfoDto }) fairness!: FairnessInfoDto;
  @ApiProperty() replayed!: boolean;
}
