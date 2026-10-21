import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { LedgerType } from '../../generated/prisma/enums';

const LEDGER_TYPES = Object.values(LedgerType);

export class TransactionQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: LEDGER_TYPES })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: LedgerType;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class WalletSummaryDto {
  @ApiProperty({ description: 'Minor units' }) balance!: number;
  @ApiProperty() dailyBonusAmount!: number;
  @ApiProperty({ nullable: true, type: String }) lastDailyBonusAt!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) nextDailyBonusAt!:
    string | null;
  @ApiProperty() canClaimDailyBonus!: boolean;
}

export class TransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LEDGER_TYPES }) type!: LedgerType;
  @ApiProperty({ description: 'Signed minor units' }) amount!: number;
  @ApiProperty() balanceAfter!: number;
  @ApiProperty({ nullable: true, type: String }) roundId!: string | null;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() createdAt!: string;
}

export class TransactionPageDto {
  @ApiProperty({ type: [TransactionDto] }) items!: TransactionDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}
