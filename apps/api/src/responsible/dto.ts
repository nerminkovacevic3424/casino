import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { COOL_OFF_PERIODS, EXCLUSION_PERIODS } from './responsible.service';

/** `null` removes a limit; omitted fields are unchanged. Money in minor units. */
export class UpdateLimitsDto {
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  dailyLossLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  weeklyLossLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  monthlyLossLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  dailyWagerLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Minutes' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  sessionLimitMinutes?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Minutes' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(5)
  @Max(240)
  realityCheckMinutes?: number | null;
}

export class CoolOffDto {
  @ApiProperty({ enum: Object.keys(COOL_OFF_PERIODS) })
  @IsIn(Object.keys(COOL_OFF_PERIODS))
  period!: keyof typeof COOL_OFF_PERIODS;
}

export class SelfExcludeDto {
  @ApiProperty({ enum: Object.keys(EXCLUSION_PERIODS) })
  @IsIn(Object.keys(EXCLUSION_PERIODS))
  period!: keyof typeof EXCLUSION_PERIODS;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ActivityQueryDto {
  @ApiProperty({ description: 'ISO 8601 start of the session' })
  @IsDateString()
  since!: string;
}
