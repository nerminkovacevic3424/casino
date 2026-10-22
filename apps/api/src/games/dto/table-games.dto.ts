import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const ROULETTE_TYPES = [
  'straight',
  'split',
  'street',
  'corner',
  'sixline',
  'column',
  'dozen',
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
] as const;

/** Shape only; the engine validates which number combinations form a legal bet. */
export class RouletteBetDto {
  @ApiProperty({ enum: ROULETTE_TYPES })
  @IsIn(ROULETTE_TYPES)
  type!: (typeof ROULETTE_TYPES)[number];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Inside bets: the covered numbers',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(36, { each: true })
  numbers?: number[];

  @ApiPropertyOptional({
    enum: [1, 2, 3],
    description: 'Column or dozen number',
  })
  @IsOptional()
  @IsIn([1, 2, 3])
  index?: 1 | 2 | 3;

  @ApiProperty({ description: 'Minor units' })
  @IsInt()
  @IsPositive()
  amount!: number;
}

export class RouletteSpinDto {
  @ApiProperty({ type: [RouletteBetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(150)
  @ValidateNested({ each: true })
  @Type(() => RouletteBetDto)
  bets!: RouletteBetDto[];
}

export class BlackjackDealDto {
  @ApiProperty({
    description: 'Minor units; even, between the table minimum and maximum',
  })
  @IsInt()
  @IsPositive()
  bet!: number;
}

const BLACKJACK_ACTIONS = [
  'hit',
  'stand',
  'double',
  'split',
  'insurance',
  'no-insurance',
] as const;

export class BlackjackActionDto {
  @ApiProperty({ enum: BLACKJACK_ACTIONS })
  @IsIn(BLACKJACK_ACTIONS)
  action!: (typeof BLACKJACK_ACTIONS)[number];

  @ApiProperty({
    description:
      'Number of decisions already made in this hand (from the last response)',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  seq!: number;
}

export class VideoPokerDealDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  coins!: number;

  @ApiProperty({ description: 'Coin value in minor units' })
  @IsInt()
  @IsPositive()
  coinValue!: number;
}

export class VideoPokerDrawDto {
  @ApiProperty({ type: [Boolean], minItems: 5, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @IsBoolean({ each: true })
  held!: boolean[];
}
