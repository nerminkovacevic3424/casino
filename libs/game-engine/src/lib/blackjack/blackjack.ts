import { Card, shuffledDeck } from '../cards/cards';
import { Minor, assertPositiveMinor } from '../money';
import { Rng } from '../rng/rng';
import { cardValue, handValue, isBlackjack, isBust } from './hand';

export interface BlackjackRules {
  readonly decks: number;
  /** false = dealer stands on soft 17 (S17). */
  readonly dealerHitsSoft17: boolean;
  readonly maxHands: number;
  readonly doubleAfterSplit: boolean;
  readonly minBet: Minor;
  readonly maxBet: Minor;
}

export const DEFAULT_BLACKJACK_RULES: BlackjackRules = {
  decks: 6,
  dealerHitsSoft17: false,
  maxHands: 4,
  doubleAfterSplit: true,
  minBet: 100,
  maxBet: 100_000,
};

export type HandOutcome = 'blackjack' | 'win' | 'push' | 'lose';

export interface PlayerHand {
  readonly cards: readonly Card[];
  readonly bet: Minor;
  readonly doubled: boolean;
  readonly fromSplit: boolean;
  readonly splitAces: boolean;
  readonly done: boolean;
  readonly outcome: HandOutcome | null;
  /** Amount returned for this hand at settlement (stake + win). */
  readonly payout: Minor;
}

export type BlackjackPhase = 'insurance' | 'player' | 'settled';

export interface BlackjackState {
  readonly phase: BlackjackPhase;
  readonly rules: BlackjackRules;
  /** Full shuffled shoe for this round; never sent to the client. */
  readonly shoe: readonly Card[];
  readonly next: number;
  readonly dealer: readonly Card[];
  readonly hands: readonly PlayerHand[];
  readonly active: number;
  readonly baseBet: Minor;
  readonly insurance: {
    readonly offered: boolean;
    readonly taken: boolean;
    readonly bet: Minor;
    readonly payout: Minor;
  };
  /** Sum of everything debited so far (base bet, doubles, splits, insurance). */
  readonly totalStaked: Minor;
  /** Sum of everything returned at settlement. */
  readonly totalPayout: Minor;
}

export type BlackjackAction =
  'hit' | 'stand' | 'double' | 'split' | 'insurance' | 'no-insurance';

export interface BlackjackTransition {
  readonly state: BlackjackState;
  /** Additional stake this action requires (must be debited atomically with it). */
  readonly debit: Minor;
}

export class IllegalActionError extends Error {
  override readonly name = 'IllegalActionError';
}

// ------------------------------------------------------------------ helpers

function draw(state: BlackjackState): [Card, BlackjackState] {
  if (state.next >= state.shoe.length) throw new Error('Shoe exhausted');
  return [state.shoe[state.next], { ...state, next: state.next + 1 }];
}

const updateHand = (
  state: BlackjackState,
  index: number,
  patch: Partial<PlayerHand>,
): BlackjackState => ({
  ...state,
  hands: state.hands.map((h, i) => (i === index ? { ...h, ...patch } : h)),
});

const newHand = (
  cards: Card[],
  bet: Minor,
  fromSplit = false,
  splitAces = false,
): PlayerHand => ({
  cards,
  bet,
  doubled: false,
  fromSplit,
  splitAces,
  done: false,
  outcome: null,
  payout: 0,
});

const peekCandidate = (up: Card): boolean => cardValue(up) >= 10;

// ------------------------------------------------------------------ dealing

export function assertBlackjackBet(
  bet: Minor,
  rules = DEFAULT_BLACKJACK_RULES,
): void {
  assertPositiveMinor(bet, 'bet');
  // Even amounts keep the 3:2 payout and the half-bet insurance in whole minor units.
  if (bet % 2 !== 0)
    throw new RangeError('Blackjack bet must be an even number of minor units');
  if (bet < rules.minBet || bet > rules.maxBet)
    throw new RangeError('Bet outside table limits');
}

/** Starts a round: shuffles a fresh shoe from `rng` and deals P, D, P, D(hole). */
export function dealBlackjack(
  bet: Minor,
  rng: Rng,
  rules = DEFAULT_BLACKJACK_RULES,
): BlackjackState {
  assertBlackjackBet(bet, rules);
  const shoe = shuffledDeck(rng, rules.decks);
  return startRound(shoe, bet, rules);
}

/** Deals from a prepared shoe — exposed for deterministic tests and verification. */
export function startRound(
  shoe: readonly Card[],
  bet: Minor,
  rules = DEFAULT_BLACKJACK_RULES,
): BlackjackState {
  const [p1, d1, p2, d2] = shoe;
  const state: BlackjackState = {
    phase: 'player',
    rules,
    shoe,
    next: 4,
    dealer: [d1, d2],
    hands: [newHand([p1, p2], bet)],
    active: 0,
    baseBet: bet,
    insurance: { offered: false, taken: false, bet: 0, payout: 0 },
    totalStaked: bet,
    totalPayout: 0,
  };
  if (d1.rank === 14) {
    return {
      ...state,
      phase: 'insurance',
      insurance: { ...state.insurance, offered: true },
    };
  }
  return resolvePeek(state);
}

/** Dealer checks the hole card for blackjack (only when showing a 10 or an ace). */
function resolvePeek(state: BlackjackState): BlackjackState {
  const dealerBj = peekCandidate(state.dealer[0]) && isBlackjack(state.dealer);
  const playerBj = isBlackjack(state.hands[0].cards);
  if (dealerBj || playerBj) return settle(state, false);
  return { ...state, phase: 'player' };
}

// ------------------------------------------------------------------ actions

export function legalActions(state: BlackjackState): BlackjackAction[] {
  if (state.phase === 'insurance') return ['insurance', 'no-insurance'];
  if (state.phase !== 'player') return [];
  const hand = state.hands[state.active];
  const actions: BlackjackAction[] = ['hit', 'stand'];
  if (
    hand.cards.length === 2 &&
    (!hand.fromSplit || state.rules.doubleAfterSplit)
  )
    actions.push('double');
  if (
    hand.cards.length === 2 &&
    cardValue(hand.cards[0]) === cardValue(hand.cards[1]) &&
    state.hands.length < state.rules.maxHands
  ) {
    actions.push('split');
  }
  return actions;
}

export function applyBlackjackAction(
  state: BlackjackState,
  action: BlackjackAction,
): BlackjackTransition {
  if (!legalActions(state).includes(action)) {
    throw new IllegalActionError(
      `Action "${action}" is not allowed in phase "${state.phase}"`,
    );
  }
  switch (action) {
    case 'insurance': {
      const bet = state.baseBet / 2;
      const s: BlackjackState = {
        ...state,
        insurance: { ...state.insurance, taken: true, bet },
        totalStaked: state.totalStaked + bet,
      };
      return { state: resolvePeek(s), debit: bet };
    }
    case 'no-insurance':
      return { state: resolvePeek(state), debit: 0 };
    case 'hit': {
      const [card, s] = draw(state);
      const hand = s.hands[s.active];
      const cards = [...hand.cards, card];
      const total = handValue(cards).total;
      return {
        state: advance(updateHand(s, s.active, { cards, done: total >= 21 })),
        debit: 0,
      };
    }
    case 'stand':
      return {
        state: advance(updateHand(state, state.active, { done: true })),
        debit: 0,
      };
    case 'double': {
      const hand = state.hands[state.active];
      const [card, s] = draw(state);
      const next = updateHand(s, s.active, {
        cards: [...hand.cards, card],
        bet: hand.bet * 2,
        doubled: true,
        done: true,
      });
      return {
        state: advance({ ...next, totalStaked: next.totalStaked + hand.bet }),
        debit: hand.bet,
      };
    }
    case 'split': {
      const hand = state.hands[state.active];
      const aces = hand.cards[0].rank === 14;
      const first = newHand([hand.cards[0]], hand.bet, true, aces);
      const second = newHand([hand.cards[1]], hand.bet, true, aces);
      const hands = [...state.hands];
      hands.splice(state.active, 1, first, second);
      let s: BlackjackState = {
        ...state,
        hands,
        totalStaked: state.totalStaked + hand.bet,
      };
      s = dealSecondCard(s, s.active);
      if (aces) {
        // Split aces receive exactly one card each and stand.
        s = dealSecondCard(s, s.active + 1);
        s = updateHand(updateHand(s, s.active, { done: true }), s.active + 1, {
          done: true,
        });
      }
      return { state: advance(s), debit: hand.bet };
    }
  }
}

function dealSecondCard(state: BlackjackState, index: number): BlackjackState {
  const [card, s] = draw(state);
  const hand = s.hands[index];
  const cards = [...hand.cards, card];
  // A split hand reaching 21 stands automatically (it is not a blackjack).
  return updateHand(s, index, {
    cards,
    done: hand.splitAces || handValue(cards).total === 21,
  });
}

/** Moves to the next unfinished hand (dealing split hands their second card) or finishes the round. */
function advance(state: BlackjackState): BlackjackState {
  let s = state;
  let index = s.hands.findIndex((h) => !h.done);
  while (index !== -1) {
    if (s.hands[index].cards.length === 1) {
      s = dealSecondCard(s, index);
      if (s.hands[index].done) {
        index = s.hands.findIndex((h) => !h.done);
        continue;
      }
    }
    return { ...s, active: index };
  }
  return settle(s, true);
}

// ------------------------------------------------------------------ settlement

function playDealer(state: BlackjackState): BlackjackState {
  let s = state;
  for (;;) {
    const { total, soft } = handValue(s.dealer);
    const hits =
      total < 17 || (total === 17 && soft && s.rules.dealerHitsSoft17);
    if (!hits) return s;
    const [card, next] = draw(s);
    s = { ...next, dealer: [...next.dealer, card] };
  }
}

function settle(state: BlackjackState, dealerPlays: boolean): BlackjackState {
  const dealerBj = isBlackjack(state.dealer);
  const anyLive = state.hands.some((h) => !isBust(h.cards));
  const s = dealerPlays && anyLive && !dealerBj ? playDealer(state) : state;
  const dealerTotal = handValue(s.dealer).total;
  const dealerBust = dealerTotal > 21;
  const naturalAllowed = s.hands.length === 1;

  const hands = s.hands.map((hand): PlayerHand => {
    const playerBj =
      naturalAllowed && !hand.fromSplit && isBlackjack(hand.cards);
    const total = handValue(hand.cards).total;
    let outcome: HandOutcome;
    if (playerBj && dealerBj) outcome = 'push';
    else if (playerBj) outcome = 'blackjack';
    else if (dealerBj) outcome = 'lose';
    else if (total > 21) outcome = 'lose';
    else if (dealerBust || total > dealerTotal) outcome = 'win';
    else if (total === dealerTotal) outcome = 'push';
    else outcome = 'lose';

    const payout =
      outcome === 'blackjack'
        ? hand.bet + (hand.bet * 3) / 2
        : outcome === 'win'
          ? hand.bet * 2
          : outcome === 'push'
            ? hand.bet
            : 0;
    return { ...hand, done: true, outcome, payout };
  });

  // Insurance pays 2:1 when the dealer has blackjack.
  const insurancePayout =
    s.insurance.taken && dealerBj ? s.insurance.bet * 3 : 0;
  return {
    ...s,
    phase: 'settled',
    hands,
    insurance: { ...s.insurance, payout: insurancePayout },
    totalPayout: hands.reduce((sum, h) => sum + h.payout, 0) + insurancePayout,
  };
}

// ------------------------------------------------------------------ client view

export interface BlackjackPublicHand {
  readonly cards: readonly Card[];
  readonly total: number;
  readonly soft: boolean;
  readonly bet: Minor;
  readonly doubled: boolean;
  readonly done: boolean;
  readonly outcome: HandOutcome | null;
  readonly payout: Minor;
}

export interface BlackjackPublicView {
  readonly phase: BlackjackPhase;
  /** Hole card is `null` until the round is settled. */
  readonly dealer: readonly (Card | null)[];
  readonly dealerTotal: number | null;
  readonly hands: readonly BlackjackPublicHand[];
  readonly active: number;
  readonly baseBet: Minor;
  readonly insurance: BlackjackState['insurance'];
  readonly legalActions: BlackjackAction[];
  readonly totalStaked: Minor;
  readonly totalPayout: Minor;
}

/** Strips everything the player must not see (shoe, hole card). */
export function toPublicView(state: BlackjackState): BlackjackPublicView {
  const settled = state.phase === 'settled';
  return {
    phase: state.phase,
    dealer: settled ? state.dealer : [state.dealer[0], null],
    dealerTotal: settled ? handValue(state.dealer).total : null,
    hands: state.hands.map((h) => ({
      cards: h.cards,
      ...handValue(h.cards),
      bet: h.bet,
      doubled: h.doubled,
      done: h.done,
      outcome: h.outcome,
      payout: h.payout,
    })),
    active: state.active,
    baseBet: state.baseBet,
    insurance: state.insurance,
    legalActions: legalActions(state),
    totalStaked: state.totalStaked,
    totalPayout: state.totalPayout,
  };
}
