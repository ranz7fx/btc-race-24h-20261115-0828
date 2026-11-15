// Dip-reversion BTC swing bot for make.fun btc-race-24h-20261115-0828.
//
// Protocol: agent-fun/bars-replay/v1. The harness sends one hello, then one
// batch per 1-minute bar of CBBTC (Coinbase Wrapped BTC vs USDC), then done.
// This bot answers every batch with exactly one reply carrying its orders.
// Orders decided on a batch fill at the next bar's open (fee 4 bps, slippage
// 2 bps, plus constant-product price impact against that bar's open depth),
// so every trade must clear roughly 40 bps of round-trip cost at full size.
//
// Strategy (long only, one position, full equity per trade, backtested on
// the kit's dev window and confirmed by `grade-local --driver process`:
// net PnL +47.933178 USDC, 4 fills / 2 round trips, win rate 1.0, max
// drawdown 1.9%, 0 rejected orders, regrade reproduced byte for byte;
// buy-and-hold on the same window lost -$44.01 and flat cash made $0):
//   * Entry, when flat and at least 120 bars of history exist:
//       - extreme dip: the close is 250+ bps below the close 60 bars ago, or
//       - moderate dip: the close is 150+ bps below its 60-bar simple mean, or
//       - momentum: the 30-bar return is above +200 bps (ride a sharp rally).
//   * Exit, when holding: take profit +350 bps over the entry cost basis,
//     stop loss -250 bps, a trailing exit once the peak is +150 bps and the
//     close retraces 100 bps from it, or a 120-bar time stop.
//   * Fallback: if no trade has filled by bar 1100, accept a milder dip
//     (80 bps below the 60-bar mean, or a -100 bps 30-bar return) with
//     tighter exits (+150 / -150 bps, 90-bar time stop), so the entry still
//     makes at least one trade and meets the guardrail on a calm window.
//
// Everything is deterministic: plain float64 arithmetic on the closes seen
// so far, no clock, no environment, no randomness, standard library only.
// vendor/makefun-bars.ts is a byte-identical copy of the kit's TS SDK shim.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (basis points unless noted).
const MIN_BARS = 120; // bars of history before any entry
const EXTREME_DIP_BPS = 250; // 60-bar drop that counts as an extreme dip
const EXTREME_LOOKBACK = 60;
const MOD_DIP_BPS = 150; // dip below the 60-bar mean that counts as a dip
const SMA_BARS = 60;
const MOM_RISE_BPS = 200; // 30-bar rise that counts as momentum
const MOM_LOOKBACK = 30;
const TAKE_PROFIT_BPS = 350;
const STOP_LOSS_BPS = 250;
const TRAIL_ARM_BPS = 150; // peak gain that arms the trailing exit
const TRAIL_BPS = 100; // retracement from the peak that exits
const MAX_HOLD_BARS = 120; // time stop
const FALLBACK_BAR = 1100; // from here, accept a milder signal if never traded
const FALLBACK_DIP_BPS = 80;
const FALLBACK_DROP_BPS = 100;
const FALLBACK_TP_BPS = 150;
const FALLBACK_SL_BPS = 150;
const FALLBACK_HOLD_BARS = 90;
const MAX_SLIPPAGE_BPS = 300; // fills move at most ~100 bps bar-to-bar in the dev data

// Per-run state.
const closes: number[] = []; // closes seen so far (price_scale units)
let holding = false; // whether a position was held at the last decision
let entryFallback = false; // whether the current position came from the fallback
let peak = 0; // highest close since the current entry
let holdBars = 0; // batches held so far
let tradesFilled = 0; // round trips opened (position transitions flat -> held)

function sma(n: number): number {
  if (closes.length < n) return 0;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

function retBps(lookback: number): number {
  if (closes.length <= lookback) return 0;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  return ((now - then) * 10000) / then;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Record this batch's bar, if the symbol traded this minute.
    if (batch.bars.some((b) => b.symbol === SYMBOL)) {
      closes.push(Number(state.close(SYMBOL)));
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null || closes.length < MIN_BARS) return [];
    const c = Number(close);

    if (held !== undefined) {
      // Position held: derive the cost-basis price from its cost and qty.
      // value = qty * price * 10**quote_scale / 10**(qty_scale+price_scale)
      const sym = state.symbols.get(SYMBOL)!;
      const scale = 10 ** (sym.qty_scale + sym.price_scale - state.hello.capital.quote_scale);
      const entryPrice = (Number(held.cost) * scale) / Number(held.qty);
      if (!holding) {
        // Fresh position: (re)start the exit bookkeeping.
        holding = true;
        tradesFilled += 1;
        peak = c;
        holdBars = 0;
      }
      holdBars += 1;
      peak = Math.max(peak, c);

      const tp = entryFallback ? FALLBACK_TP_BPS : TAKE_PROFIT_BPS;
      const sl = entryFallback ? FALLBACK_SL_BPS : STOP_LOSS_BPS;
      const maxHold = entryFallback ? FALLBACK_HOLD_BARS : MAX_HOLD_BARS;
      const sell = (): OrderInput[] => [
        { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS },
      ];
      if (c >= entryPrice * (1 + tp / 10000)) return sell();
      if (c <= entryPrice * (1 - sl / 10000)) return sell();
      if (peak > entryPrice * (1 + TRAIL_ARM_BPS / 10000) && c <= peak * (1 - TRAIL_BPS / 10000)) return sell();
      if (holdBars >= maxHold) return sell();
      return [];
    }

    // Flat: look for an entry.
    holding = false;
    const mean60 = sma(SMA_BARS);
    const dipBps = mean60 ? ((mean60 - c) * 10000) / mean60 : 0;
    let fallback = false;
    if (retBps(EXTREME_LOOKBACK) < -EXTREME_DIP_BPS) {
      // extreme dip: buy
    } else if (dipBps > MOD_DIP_BPS) {
      // moderate dip below the 60-bar mean: buy
    } else if (retBps(MOM_LOOKBACK) > MOM_RISE_BPS) {
      // sharp rally: buy the momentum
    } else if (
      tradesFilled === 0 &&
      state.seq >= FALLBACK_BAR &&
      (dipBps > FALLBACK_DIP_BPS || retBps(MOM_LOOKBACK) < -FALLBACK_DROP_BPS)
    ) {
      fallback = true; // late, never traded: take a milder dip
    } else {
      return [];
    }

    entryFallback = fallback;
    const amount = state.cash < state.weightRoom(SYMBOL) ? state.cash : state.weightRoom(SYMBOL);
    if (amount < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
