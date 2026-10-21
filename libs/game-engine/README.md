# @casino/game-engine

Pure, framework-agnostic TypeScript for every game. The API uses it to resolve bets; the web app uses it for display,
client-side validation and the "Verify bet" page. It has no runtime dependencies and never uses `Math.random`.

| Module              | What it does                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `rng/sha256`        | Pure SHA-256 / HMAC-SHA256 (browser + Node), cross-checked against `node:crypto`                                                           |
| `rng/provably-fair` | `HMAC(serverSeed, clientSeed:nonce:round)` byte stream, seed commitment and verification                                                   |
| `rng/rng`           | `Rng` interface, unbiased `randomInt`, weighted picks, Fisher–Yates, seeded sim RNG                                                        |
| `slots`             | Data-driven lines engine (paylines, wilds, scatters, free spins, pick bonus) and ways engine (variable rows, cascades, growing multiplier) |
| `slots/configs`     | Classic 3-Reel, Gem Vault (video 5-reel), Temple Tumble (megaways-style)                                                                   |
| `roulette`          | European wheel, every bet type with layout validation, racetrack bets, hot/cold stats                                                      |
| `blackjack`         | Immutable state machine (6 decks, S17, 3:2, split/double/insurance) and basic-strategy hints                                               |
| `video-poker`       | 9/6 Jacks or Better deal/hold/draw and hand evaluation                                                                                     |
| `verify`            | `replayRound()` recomputes any round from revealed seeds + the player's inputs                                                             |
| `simulation`        | RTP / hit frequency / volatility accumulators, exact enumeration for small line games                                                      |

Money is always integer minor units (`Minor`); helpers in `money.ts` refuse fractions and overflow.

## Commands

```bash
pnpm nx test game-engine                 # unit tests, 90% coverage threshold
pnpm nx run game-engine:simulate         # 10M spins per slot, prints RTP / hit rate / volatility
pnpm nx run game-engine:rtp-check        # CI gate: fails if any slot drifts > ±0.5% from its target
pnpm tsx libs/game-engine/scripts/simulate-rtp.ts --game megaways --spins 2000000 --seed 7 --json
```
