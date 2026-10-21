import { Module } from '@nestjs/common';
import { FairnessService } from '../fairness/fairness.service';
import { WalletModule } from '../wallet/wallet.module';
import { GameSettingsService } from './game-settings.service';
import { GamesController } from './games.controller';
import { RoundsService } from './rounds.service';
import { SlotsController } from './slots.controller';

@Module({
  imports: [WalletModule],
  controllers: [GamesController, SlotsController],
  providers: [RoundsService, FairnessService, GameSettingsService],
  exports: [RoundsService, FairnessService, GameSettingsService],
})
export class GamesModule {}
