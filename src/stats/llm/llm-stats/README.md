# LLM Stats

This module builds the public selected-LLM stats payload returned by:

- `getModelStatsSelected()`
- `getModelStatsSelectedLive()`

The goal is not to reproduce any single upstream leaderboard exactly. The goal is to produce a practical comparison surface for model selection:

- scraper-first and robust against upstream API drift
- stable enough for downstream apps
- explicit about the scoring choices we made
- biased toward recent, current, usable models instead of archival completeness

## Pipeline

The pipeline is stage-based:

1. `source-stage.ts`
   Fetches current Artificial Analysis scraper rows and `models.dev` metadata.

2. `match-stage.ts`
   Matches Artificial Analysis rows to canonical `models.dev` model ids.

3. `openrouter-stage.ts`
   Enriches matched rows with OpenRouter speed and weighted pricing data.

4. `final-stage.ts`
   Projects the public model shape, computes raw scores, computes normalized relative scores, filters weak rows, sorts, and prunes sparse fields.

5. `cache.ts`
   Stores list-mode payloads on disk. Single-model lookup stays in-memory.

## Philosophy

This module intentionally mixes several ideas instead of pretending there is one perfect score.

- Intelligence should reflect both broad leaderboard strength and benchmark evidence.
- Agentic ability should reflect both an upstream agentic index and concrete task-style evaluations.
- Speed should reward real usable responsiveness, not just one raw latency number.
- Price should favor cheaper models, but use weighted pricing when OpenRouter provides a more realistic blended cost signal.
- The final ranking should be easy to consume, which is why the API exposes both raw `scores` and normalized `relative_scores`.

In short:

- `scores` are the raw math layer.
- `relative_scores` are the comparison layer.

## Source Preference

The live pipeline is now Artificial Analysis scraper-first.

- Artificial Analysis provides the benchmark and intelligence fields.
- `models.dev` provides canonical ids and model metadata.
- OpenRouter provides enrichment for speed and weighted pricing.

The public payload also includes `metadata` so the chosen benchmark groups are visible at the API boundary rather than hidden only in code.

## Scoring Inputs

The current benchmark groups are configured in [llm-stats.ts](/Users/teron/Projects/llm-harness-js/src/stats/llm/llm-stats.ts:1).

Current intelligence benchmark keys:

- `omniscience_accuracy`
- `hle`
- `lcr`
- `scicode`

Current agentic benchmark keys:

- `omniscience_nonhallucination_rate`
- `gdpval_normalized`
- `ifbench`
- `terminalbench_hard`

Important detail:

- a configured benchmark key may be missing from the current upstream data
- the API surfaces that under `payload.metadata.scoring.missing_*_benchmark_keys`

## Math

The math is intentionally simple and readable.

### Intelligence Score

First compute the mean of the configured intelligence benchmark values:

```text
intelligence_benchmark_mean =
  mean([
    omniscience_accuracy,
    hle,
    lcr,
    scicode
  ])
```

Then blend that with the upstream `intelligence_index`:

```text
intelligence_score =
  (intelligence_index + intelligence_benchmark_mean * 100) / 2
```

Notes:

- benchmark values are treated as percentage-like values and multiplied by `100` before blending
- if either side is missing, `intelligence_score` becomes `null`

### Agentic Score

First compute the mean of the configured agentic benchmark values:

```text
agentic_benchmark_mean =
  mean([
    omniscience_nonhallucination_rate,
    gdpval_normalized,
    ifbench,
    terminalbench_hard
  ])
```

Then blend that with the upstream `agentic_index`:

```text
agentic_score =
  (agentic_index + agentic_benchmark_mean * 100) / 2
```

Notes:

- `omniscience_nonhallucination_rate` is read from the normalized non-hallucination key when present
- if the upstream payload exposes the older hallucination-rate key, the code still maps it into non-hallucination semantics first

### Price Score

Price is inverted so cheaper models score higher:

```text
price_score = 1 / blended_price
```

The important part is how `blended_price` is chosen.

The module prefers OpenRouter weighted pricing when available:

```text
blended_price =
  weighted_input_ratio  * weighted_input_cost +
  weighted_output_ratio * weighted_output_cost
```

Current weights:

- `weighted_input_ratio = 0.75`
- `weighted_output_ratio = 0.25`

If OpenRouter weighted pricing is missing, the module falls back to a proxy built from base input/output pricing and cache pricing. If context-over-200k pricing exists, it contributes a small additional adjustment.

This is not meant to be a perfect economic simulator. It is meant to provide a stable practical cost heuristic.

### Speed Score

Speed is based on two ideas:

1. imagined completion speed for several representative output lengths
2. observed end-to-end speed using a representative token target

For each anchor token count:

```text
imagined_speed(anchor_tokens) =
  anchor_tokens /
  (latency_seconds + anchor_tokens / throughput_tokens_per_second)
```

Then:

```text
imagined_speed_score = mean(imagined_speed(anchor_tokens) for all anchors)
```

The second part uses observed end-to-end latency:

```text
observed_e2e_speed_score =
  representative_target_tokens / e2e_latency_seconds
```

Finally:

```text
speed_score =
  mean([imagined_speed_score, observed_e2e_speed_score])
```

Where do the anchor token counts come from?

- first choice: derive them from live OpenRouter observations
- fallback: use default anchors

Current fallback anchors:

- `200`
- `500`
- `1000`
- `2000`
- `8000`

When enough live OpenRouter observations exist, the code derives implied output lengths from:

```text
(e2e_latency_seconds - latency_seconds) * throughput_tokens_per_second
```

It then takes min, 25th percentile, median, 75th percentile, and max, and remaps those values into the stable range `200..8000`.

This keeps the speed score practical across both short and long answers instead of overfitting to a single request length.

### Relative Scores

Raw scores are useful, but not very ergonomic for ranking. So the module also attaches normalized `relative_scores`.

#### Intelligence Relative Score

```text
intelligence_relative_score =
  min_max_scale(intelligence_score) on a 0..100 range
```

#### Agentic Relative Score

```text
agentic_relative_score =
  min_max_scale(agentic_score) on a 0..100 range
```

#### Speed Relative Score

```text
speed_relative_score =
  percentile_rank(speed_score)
```

#### Price Relative Score

```text
price_relative_score =
  percentile_rank(price_score)
```

#### Overall Relative Score

The final overall comparison score is a weighted mean:

```text
overall_score =
  weighted_mean([
    intelligence_relative_score * 0.40,
    agentic_relative_score      * 0.35,
    speed_relative_score        * 0.10,
    price_relative_score        * 0.15
  ])
```

Current overall weights:

- intelligence: `0.40`
- agentic: `0.35`
- speed: `0.10`
- price: `0.15`

So the ranking is intentionally quality-first:

- intelligence and agentic matter most
- price and speed still matter, but they do not dominate

## Filtering

Not every matched model makes it into the final public list.

### Low-Signal Filter

A model is dropped unless all of these relative scores exist and are at least `10`:

- `overall_score`
- `intelligence_score`
- `agentic_score`
- `speed_score`

This removes rows that are technically matchable but too sparse or weak to be useful in the main public comparison set.

### Deprecated Models

Artificial Analysis deprecated rows are excluded at the scraper layer. The default public dataset is meant to follow the current live leaderboard, not the full historical corpus.

## Sorting

The final list is sorted by:

1. descending `relative_scores.intelligence_score`
2. stable id tie-breaker

This is a deliberate choice. Even though `overall_score` exists, the list is still anchored by intelligence-first ordering.

## Sparse-Field Pruning

After scoring and sorting, sparse fields are pruned so the final payload stays cleaner.

- the prune sample prefers recent releases first
- if a field is mostly null in the sample, it is dropped
- top-level stable fields are preserved
- nested pruning currently focuses on sparse `evaluations` keys

This keeps the payload stable enough for consumers while avoiding a very noisy long tail of mostly-empty fields.

## Public Metadata

The outer payload now exposes benchmark-selection metadata:

```ts
payload.metadata.artificial_analysis.available_benchmark_keys
payload.metadata.artificial_analysis.available_evaluation_keys
payload.metadata.artificial_analysis.available_intelligence_keys

payload.metadata.scoring.intelligence_benchmark_keys
payload.metadata.scoring.missing_intelligence_benchmark_keys
payload.metadata.scoring.agentic_benchmark_keys
payload.metadata.scoring.missing_agentic_benchmark_keys
payload.metadata.scoring.selected_benchmark_keys
```

This is there on purpose:

- so benchmark choices do not get buried in config
- so future tuning is easier
- so we can quickly see what is selected versus what is actually available upstream

## Non-Goals

This module does not try to do a few things:

- perfectly model every usage pattern for pricing
- perfectly reproduce Artificial Analysis ranking
- keep every historical or deprecated model
- claim that one scalar score is the truth

It is a practical selection and comparison layer, not a universal leaderboard theorem.
