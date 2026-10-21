import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'player@example.com' })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString()
  @Length(10, 128)
  password!: string;

  @ApiProperty({ example: 'LuckyLuke', minLength: 3, maxLength: 24 })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]{3,24}$/, {
    message:
      'displayName must be 3-24 letters, digits, dot, dash or underscore',
  })
  displayName!: string;

  @ApiProperty({
    example: '1990-05-17',
    description: 'Players must be 18 or older',
  })
  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @ApiProperty({
    description: 'Acceptance of the terms and the 18+ age requirement',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the terms' })
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty()
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class MfaLoginDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  mfaToken!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class EmailDto {
  @ApiProperty()
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token!: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString()
  @Length(10, 128)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString()
  @Length(10, 128)
  newPassword!: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class DisableTotpDto extends TotpCodeDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['PLAYER', 'ADMIN'] }) role!: 'PLAYER' | 'ADMIN';
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() twoFactorEnabled!: boolean;
  @ApiProperty() createdAt!: string;
}

export class AuthResponseDto {
  @ApiPropertyOptional({ type: UserDto }) user?: UserDto;
  @ApiPropertyOptional({
    description: 'Present when a TOTP code is required to finish signing in',
  })
  mfaRequired?: boolean;
  @ApiPropertyOptional() mfaToken?: string;
}

export class TotpSetupDto {
  @ApiProperty() otpauthUrl!: string;
  @ApiProperty({ description: 'PNG data URL of the QR code' })
  qrCodeDataUrl!: string;
}
