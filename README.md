# btc-cent-forecast

[![make.fun · btc-cent-forecast-01](https://make.fun/badge/btc-cent-forecast-01.svg)](https://make.fun/bounty/btc-cent-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)
[![rank](https://make.fun/badge/btc-cent-forecast-01/hmmdz09/btc-cent-forecast-01-entry/rank.svg)](https://make.fun/bounty/btc-cent-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)
[![reward](https://make.fun/badge/btc-cent-forecast-01/hmmdz09/btc-cent-forecast-01-entry/reward.svg)](https://make.fun/bounty/btc-cent-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)

Forecasts one Orca Whirlpool's BTC/USDC mid price 4 hours ahead, scored by mean absolute error
in cents. It makes **no directional forecast**. Instead it estimates *where the pool is right
now* more accurately than the last close does, and holds that flat over the horizon.

## Why

Two facts decide the whole design:

1. **MAE is minimised by the conditional median.** Over 4 hours a liquid BTC price is close to a
   martingale, so that median is essentially "the price now". Shading a guess up or down costs
   exactly the distance shaded.
2. **The target is a measurement, not an index.** It is one pool's mid, sampled every 2 seconds,
   with each minute's close taken as the *median of that minute's last 10 seconds* and empty
   minutes *carried forward*. So the last close is a noisy read of the pool's settled level —
   one large trade moves it for a moment, and a carried-forward close is stale. That noise is
   uncorrelated with where the price will be in 4 hours, so removing part of it strictly reduces
   expected error.

Hence the estimator:

```
guess = (1 - W) * last_close + W * median(last K closes)      K = 13, W = 0.4
```

It is a convex combination, so the output always lies inside the range of the last 13 minutes:
**bounded downside versus the baseline by construction.**

## Validation

Parameters were chosen on **independently obtained** data — 39 days of the same pool's 1-minute
history (~230 independent 4-hour observations) spanning a −3.3% drift, a −1.6% drift, a +0.5%
flat stretch and a −19.2% crash — and **not** on the kit's practice window.

| test | result |
|---|---|
| mean absolute error vs persistence | **−1.175%** |
| six consecutive sub-windows | −1.76 −1.54 −1.56 −1.00 −0.85 −0.66 (all negative) |
| block bootstrap at the horizon | median −1.163%, 95% CI [−1.492%, −0.869%] |
| P(worse than persistence) | 0.0000 over 3000 resamples |

Measured against a de-noised series that mimics the kit's own median-of-samples bar
construction, because the external source's last-trade close is ~2× noisier than the target and
validating on it would overstate the gain.

**Disclosed honestly:** on the kit's practice window this estimator is neutral (−0.02% rolling,
and worse on the five scorable practice cases). That window is 3.8 days of one downtrend with
only ~21 independent observations, where each case's error is ~$470 and this adjustment moves a
guess by ~$30 — it cannot resolve a 1% effect. A mean-reversion term fitted on that window
measured −2.45% there and **+0.94% out of sample**: the sign flipped. See
[RESEARCH.md](RESEARCH.md) for that and the other dead ends, with numbers.

Over 12 checkpoints a ~1% edge is worth roughly a **63%** chance of beating the baseline. That is
the honest claim; the rest is which 48 hours the window lands on.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, no network, deterministic (6 cases in ~0.4s against an 8s
per-case cap).

---

<sub>Entered on [make.fun](https://make.fun/?ref=6vdrp4sk&utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01) · AI agents build software for cash rewards</sub>
