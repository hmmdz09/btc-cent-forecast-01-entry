// btc-cent-forecast-01 entry: a robust "where is the pool now" anchor, held flat over the horizon.
//
// WHAT IS BEING FORECAST
// The target is the close of ONE Orca Whirlpool's mid price (cbBTC/USDC on Solana,
// HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM) 240 minutes after each checkpoint, scored by
// MEAN ABSOLUTE ERROR in cents.
//
// THE TWO FACTS THAT DETERMINE THIS PROGRAM
//
// 1. MAE is minimised by the conditional MEDIAN of the target, not its mean. Over a 4-hour
//    horizon a liquid BTC price is very close to a martingale, so that median is essentially
//    "the price now". We therefore make NO directional forecast. This is not laziness: we
//    fitted drift terms (momentum and mean-reversion, several lookbacks) on the kit's practice
//    window and the best of them showed -2.45% versus persistence. On 39 days of independently
//    obtained data for the same pool, that same estimator came out at +0.94% -- WORSE than
//    persistence. The sign flipped. The practice window is a single 3.8-day downtrend holding
//    only ~21 independent 4-hour observations, so a reversion coefficient fitted there is a
//    trend bet, not an effect. RESEARCH.md records this and the other dead ends with numbers.
//
// 2. What IS estimable is the measurement. The scored number is not "the price of Bitcoin":
//    it is one pool's mid, read every 2 seconds, with each minute's close taken as the MEDIAN
//    of that minute's last-10-second samples, and any minute without samples carrying the
//    previous close forward. Consequently the single last close is a noisy read of the pool's
//    settled level: one large trade moves the pool for a moment, and a carried-forward close
//    is simply stale. That noise sits in our ANCHOR, and it is uncorrelated with where the
//    price will be in 4 hours, so removing part of it strictly reduces expected error.
//
// THE ESTIMATOR
//   anchor = (1 - W) * last_close + W * median(last K closes)
// A short median is the robust location estimate for exactly this kind of
// occasional-large-outlier noise, and blending rather than replacing keeps most of the weight
// on the freshest information. K = 13 minutes and W = 0.4 were chosen on independently
// obtained history, NOT on the kit's practice window, and the dependence on both is broad and
// single-peaked (every K from 5 to 31 and every W from 0.25 to 0.75 helps), which is what a
// real mechanism looks like as opposed to a fitted artifact.
//
// VALIDATION (full detail and commands in RESEARCH.md)
// On 39 days of the same pool's 1-minute history (2026-10-07 to 2026-11-15, ~230 independent
// 4-hour observations, spanning a -3.3% drift, a -1.6% drift, a +0.5% flat stretch and a
// -19.2% crash), measured against the de-noised series that mimics the kit's own
// median-of-samples bar construction:
//   mean absolute error versus persistence : -1.175%
//   six consecutive sub-windows            : -1.76 -1.54 -1.56 -1.00 -0.85 -0.66 (all negative)
//   block bootstrap at the horizon length  : median -1.163%, 95% CI [-1.492%, -0.869%]
//   probability worse than persistence     : 0.0000 over 3000 resamples
// On the kit's own practice window the same estimator is -0.02%, i.e. neutral: that window is
// too short and too trending to show the effect, which is precisely why it was not used to
// choose the parameters.
//
// BOUNDED BY CONSTRUCTION: the output is a convex combination of the last close and a median of
// recent closes, so it always lies inside the range of the last K closes. It cannot run away
// from persistence, and its worst case versus the house baseline is bounded by the spread of
// those K minutes.
//
// Deterministic: no randomness, no wall-clock, no network, no unordered iteration.
// Run locally:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the pool's 5-decimal grid. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Minutes of recent closes the robust anchor is taken over. */
const WINDOW = 13;
/** Weight on the robust median; the rest stays on the freshest close. */
const MEDIAN_WEIGHT = 0.4;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number =>
  Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/**
 * The median of a list of numbers. Sorts a copy, so the caller's array is untouched, and
 * compares numerically (JavaScript's default sort is lexicographic, which would be wrong here).
 */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error('median of an empty list');
  const mid = n >> 1;
  return n % 2 === 1 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

/**
 * The forecast for one market: a robust estimate of the pool's settled current level, held
 * flat over the 240-minute horizon because that level IS the martingale median of the target.
 */
function forecast(m: CaseMarket): number {
  const prices = m.prices;
  if (!Array.isArray(prices) || prices.length === 0) throw new Error(`market ${m.id} has no prices`);

  // Every close must be a finite number: a malformed case must fail loudly here rather than
  // silently produce a NaN guess, which would be scored as an invalid case.
  for (const p of prices) {
    if (typeof p !== 'number' || !Number.isFinite(p)) {
      throw new Error(`market ${m.id} holds a price that is not a finite number`);
    }
  }

  const last = prices[prices.length - 1] as number;

  // Not enough history for a 13-minute median: the freshest close is the best we have.
  if (prices.length < WINDOW) return price5(last);

  const robust = median(prices.slice(prices.length - WINDOW));
  return price5((1 - MEDIAN_WEIGHT) * last + MEDIAN_WEIGHT * robust);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) {
    throw new Error(`${file} does not hold exactly one market`);
  }
  const price = forecast(c.markets[0] as CaseMarket);
  writeFileSync(
    join(OUTPUT_DIR, `${id}.out`),
    `${JSON.stringify({ forecasts: [{ case: id, price }] })}\n`,
  );
}
