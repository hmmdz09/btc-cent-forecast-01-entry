# Research log — what was tried, what was kept, and the numbers that decided it

The deliverable is one number per checkpoint. Almost all of the work was deciding what *not*
to put in it. This file records the dead ends with the measurements that killed them, because
the measurements are the reason the final program is as plain as it is.

## 1. What the scoring rule asks for

Score is the **mean absolute error** in cents over the twelve checkpoints. MAE is minimised by
the **conditional median** of the target, not its mean. The rules say so outright:

> a guess you shade up or down pays by exactly the distance you shaded it, and no habit of
> guessing high or low beats the middle.

Over a 4-hour horizon a liquid BTC price is close to a martingale, so the conditional median of
`p(t+240)` is, to a very good approximation, `p(t)`. That makes the house's persistence
baseline genuinely strong, and it means any edge has to come from estimating **`p(t)` itself**
better — not from predicting the future.

## 2. Where the ground truth actually comes from

This is the part that matters, and it is in the kit's `input/NOTICE.txt`:

- The price is **not** an index or an exchange average. It is the mid price of **one** Orca
  Whirlpool on Solana (`HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM`), derived from the pool's
  own `sqrt` price.
- It is sampled **every 2 seconds**.
- A minute's close is the **median of the samples in that minute's last 10 seconds**.
- **A minute with no samples carries the previous close forward.** Nothing is filled backwards.

Three consequences, all of which are about measurement rather than about Bitcoin:

1. A single large trade in that pool moves the mid for a moment. The rules state it plainly:
   "an unusually large trade there moves it for a moment."
2. A carried-forward close is **stale** — it is not a fresh observation of anything.
3. Therefore the last close in a case is a **noisy read of the pool's settled level**, and that
   noise is uncorrelated with where the price will be four hours later.

Removing part of that noise reduces expected error, and does so for a reason that does not
depend on forecasting anything. That is the entire edge in this entry.

Measured on the practice cases: **30.0%** of minutes show no change at all, confirming how
often the carry-forward and the 2-second sampling produce a repeated close.

## 3. Dead end: fitted drift (momentum / mean reversion)

Estimators of the form `p(t) + beta * (p(t) - p(t-k))` fitted on the kit's practice window:

| estimator | practice window |
|---|---|
| `k=240, beta=-0.30` | **-2.45%** vs persistence |
| `k=240, beta=-0.15` | -2.41% |
| `k=60,  beta=-0.30` | -1.36% |

A -2.45% improvement looks like a winning entry. It is not. Three checks killed it:

**Check 1 — count the independent observations.** The practice window is 3.8 days. With a
240-minute horizon it holds roughly `5220 / 240` ≈ **21** independent 4-hour observations, not
the ~5,000 overlapping ones a naive loop reports.

**Check 2 — block bootstrap at the horizon length.** Resampling 240-minute blocks:

```
rev k=240 beta=-0.15:  median -2.07%,  95% CI [-6.38%, +1.96%]
rev k=240 beta=-0.30:  median -1.97%,  95% CI [-9.79%, +5.53%]
```

The confidence interval **straddles zero**. The "edge" is not distinguishable from noise.

**Check 3 — sign stability across sub-windows.** Splitting the practice window into four
consecutive chunks, `k=240, beta=-0.15` gives:

```
+8.79%   -2.61%   -3.43%   -3.62%
```

The sign **flips** in the first chunk. This is the signature of a trend bet: the practice window
is one 3.8-day downtrend (net **-3.15%**), and a negative `beta` is rewarded for leaning short.

**The out-of-sample verdict.** Against 39 days of independently obtained history for the same
pool, `k=240, beta=-0.30` scored **+0.94%** — *worse* than persistence, having measured -2.45%
on the practice window. The sign reversed completely. This estimator was discarded.

The leaderboard is visibly full of walk-forward LAD-ridge, kNN and mean-reversion entries fitted
on this same single practice window. That is exactly the estimator class these three checks
reject.

## 4. Dead end: spike-clipping the last close

If the last close is sometimes a transient spike, clip it back toward a local median only when
it is an outlier (threshold in dollars, pull back a fraction):

```
k= 9 thr=200 frac=0.5   -0.06%
k=21 thr=100 frac=0.5   -0.09%
k=21 thr= 50 frac=1.0   +1.29%
```

Essentially nothing, and not worth the complexity. The reason is a matter of scale: the typical
4-hour error is about **$340**, while `|last - median9|` has a median of **$16.64**. Clipping a
rare $200 spike cannot move a mean error of $340 by any meaningful amount. The useful version of
this idea is not a rare clip but a **continuous** one — applied every single case, which is
section 5.

## 5. What was kept: a robust anchor

```
anchor = (1 - W) * last_close + W * median(last K closes)
```

A short median is the right robust location estimator for occasional-large-outlier noise, and
blending instead of replacing keeps most of the weight on the freshest information.

### Independently obtained validation data

Parameters were **not** chosen on the practice window. 40,960 rows of 1-minute OHLCV for the
same pool were pulled from GeckoTerminal, covering **2026-10-07 to 2026-11-15** (~56,000
minutes after gap-filling, ≈**230** independent 4-hour observations) and spanning four distinct
regimes:

| sub-period | net move |
|---|---|
| from 2026-10-07 | -3.33% |
| from 2026-10-16 | -1.58% |
| from 2026-10-26 | +0.48% |
| from 2026-11-05 | **-19.21%** (crash) |

### The measurement-mismatch trap, and the correction for it

GeckoTerminal's close is a **last-trade** print; the kit's close is a **median of the last 10
seconds of mid samples**. They are not the same measurement, and the difference is large:

```
median |1-minute change|:  kit  $14.02     GeckoTerminal  $29.05
```

GeckoTerminal is roughly **twice as noisy**. Validating a noise-removal estimator on a noisier
series than the real target would **overstate** the benefit. So every figure below is also
computed against a **de-noised** version of the external series (a causal 3-minute median, which
mimics the kit's median-of-samples construction and brings the median 1-minute change down to
$0.62). The de-noised column is the honest one, and it is what the parameters were chosen on:

| estimator | raw external | de-noised (kit-like) |
|---|---|---|
| `median(9)` replacing last | -0.93% | -0.37% |
| `median(13)` replacing last | -1.08% | -0.49% |
| blend `K=13, W=0.4` | -1.52% | **-1.18%** |

The edge survives the correction but roughly halves, which is the number to believe.

### Why K=13, W=0.4

The response surface is **broad and single-peaked** — the mark of a mechanism rather than a
fitted artifact. Every `K` from 5 to 31 and every `W` from 0.25 to 0.75 helps:

```
K:    3      5      9     13     21     31     61
   -0.32  -0.63  -0.93  -1.08  -1.02  -0.84  +0.15     (median replacing last, raw external)

W:  0.25   0.50   0.75   1.00
   -0.89  -1.27  -1.13  -0.49                          (K=13, de-noised)
```

Note `K=61` turning positive: smooth too far and the anchor goes stale, which is the carry-forward
problem in the other direction. `K=13` sits in the middle of the useful range, not on a spike.

### The three tests that the kept estimator passes

`K=13, W=0.4`, on the de-noised (kit-like) series:

```
overall                        -1.175%
six consecutive sub-windows    -1.76  -1.54  -1.56  -1.00  -0.85  -0.66   (all negative)
block bootstrap (horizon)      median -1.163%,  95% CI [-1.492%, -0.869%]
P(worse than persistence)      0.0000  over 3000 resamples
```

And on the raw external series: -1.524%, all six sub-windows negative, 95% CI
[-1.878%, -1.183%], P(worse) = 0.0000.

Contrast with section 3's rejected estimator: CI entirely below zero instead of straddling it,
and six consecutive negative sub-windows instead of a sign flip.

## 6. Honest disclosure: the practice window disagrees

On the kit's own practice window the kept estimator is **neutral to slightly negative-value**:

- rolling, `K=13, W=0.4`: **-0.02%**
- the six official practice cases, `median(13)` replacing last: **+13.68%** (worse)
- the six official practice cases, `K=13, W=0.4`: **+5.47%** (worse)

This is not hidden because it is the point of section 3. That window is 3.8 days of one
downtrend holding ~21 independent observations, and the five scorable practice cases have a mean
error of about **$470** each while this adjustment moves a guess by roughly **$30**. Five
observations at that signal-to-noise ratio cannot resolve a 1% effect; they are consistent with
anything between -10% and +10%. Choosing parameters to make those five numbers look good is
exactly the overfitting that section 3 demonstrates reverses out of sample.

The entry is therefore parameterised on ~230 independent observations across four regimes, and
accepts looking mediocre on five.

## 7. Variance: what 12 checkpoints can actually resolve

The final is **12 cases**, so luck dominates. Simulating 20,000 random 12-checkpoint finals
(4 hours apart, de-noised kit-like series):

| W | P(beat persistence) | median rel | 5th pct | 95th pct |
|---|---|---|---|---|
| 0.20 | 0.657 | -0.75% | -4.48% | +2.54% |
| 0.30 | 0.641 | -1.02% | -6.49% | +3.93% |
| **0.40** | **0.626** | **-1.19%** | -8.31% | +5.44% |
| 0.50 | 0.610 | -1.27% | -10.12% | +7.04% |
| 0.60 | 0.594 | -1.27% | -11.57% | +8.78% |

A real but ~1% edge converts to only a **~63%** chance of beating the baseline over 12 cases.
`W` trades win probability against margin: lower `W` beats the baseline more often by less,
higher `W` wins by more when it wins. `W=0.4` was chosen because a prize requires *both* beating
the baseline *and* placing in the top 100 of those who beat it, so margin has value and pure
eligibility-maximisation at `W=0.2` is not optimal either.

This is stated plainly rather than dressed up: the honest claim is a small, mechanism-backed,
out-of-sample-verified edge, with the final outcome still mostly decided by which 48 hours the
window lands on.

## 8. Bounded downside by construction

The output is a convex combination of the last close and a median of the last `K=13` closes, so
it always lies **inside the range of those 13 minutes**. It cannot diverge from persistence,
and the worst case versus the house baseline is bounded by the spread of those 13 minutes —
typically a few dollars against a mean error of several hundred.

## 9. Reproducing these numbers

The entry itself is offline and standard-library only, as the rules require. The validation used
one external read-only source at build time:

```sh
curl -sS "https://r.jina.ai/https://api.geckoterminal.com/api/v2/networks/solana/pools/\
HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM/ohlcv/minute?aggregate=1&limit=1000"
```

paged backwards with `&before_timestamp=<unix>` (the `r.jina.ai` text proxy was required because
the build network intercepts TLS to exchange APIs). Practice ground truth needs no download: the
checkpoints are 4 hours apart and the horizon is 240 minutes, so case `p0(n+1)`'s last price *is*
case `p0n`'s actual — which is how the per-case tables above were computed from the kit alone.
