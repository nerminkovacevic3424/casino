import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JackpotService } from '../jackpot/jackpot.service';
import { PlayerController } from './player.controller';
import { ResponsibleService } from './responsible.service';

/** Responsible play, lobby personalisation, profile stats and the jackpot. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PlayerController],
  providers: [ResponsibleService, JackpotService],
  exports: [ResponsibleService, JackpotService],
})
export class PlayerModule {}
