import { SlotConfig } from '../types';
import { CLASSIC_3_REEL } from './classic-3-reel';
import { MEGAWAYS } from './megaways';
import { VIDEO_5_REEL } from './video-5-reel';

export { CLASSIC_3_REEL, MEGAWAYS, VIDEO_5_REEL };

export const SLOT_CONFIGS: Readonly<Record<string, SlotConfig>> = {
  [CLASSIC_3_REEL.id]: CLASSIC_3_REEL,
  [VIDEO_5_REEL.id]: VIDEO_5_REEL,
  [MEGAWAYS.id]: MEGAWAYS,
};

export function getSlotConfig(id: string): SlotConfig {
  const config = SLOT_CONFIGS[id];
  if (!config) throw new Error(`Unknown slot game: ${id}`);
  return config;
}
