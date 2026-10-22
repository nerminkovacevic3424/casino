import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LEDGER_TYPES, MAX_ADJUSTMENT } from '@casino/shared-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  NotEquals,
} from 'class-validator';

export class OverviewQueryDto {
  @ApiPropertyOptional({ default: 24, description: 'Window in hours' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 90)
  hours = 24;
}

export class UserListQueryDto {
  @ApiPropertyOptional({ description: 'Email or display name contains' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class LedgerQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roundId?: string;

  @ApiPropertyOptional({ enum: LEDGER_TYPES })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: (typeof LEDGER_TYPES)[number];

  @ApiPropertyOptional({ description: 'Entries older than this id' })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  before?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class AuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  before?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

export class SetGameEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class SetUserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty({ description: 'Why (kept in the audit log)' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AdjustBalanceDto {
  @ApiProperty({
    description: 'Signed minor units: positive credits, negative debits',
  })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_ADJUSTMENT)
  @Max(MAX_ADJUSTMENT)
  amount!: number;

  @ApiProperty({ description: 'Why (shown on the ledger entry)' })
  @IsString()
  @Length(3, 200)
  reason!: string;
}
