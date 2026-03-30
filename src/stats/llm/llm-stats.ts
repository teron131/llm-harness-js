/** Public LLM stats API: cache list payloads, rebuild from live sources when needed, and return failure-safe output. */
import {
  DEFAULT_OUTPUT_PATH,
  currentEpochSeconds,
  loadModelStatsSelectedFromCache,
  saveModelStatsSelectedToPath,
} from "./llm-stats/cache";
import { buildFinalModels } from "./llm-stats/final-stage";
import { enrichRows } from "./llm-stats/openrouter-stage";
import { buildMatchedRows } from "./llm-stats/match-stage";
import { fetchSourceData } from "./llm-stats/source-stage";
import {
  type LlmStatsStageConfig,
  type ModelStatsSelectedModel,
  type ModelStatsSelectedOptions,
  type ModelStatsSelectedPayload,
} from "./llm-stats/types";

export type {
  LlmStatsStageConfig,
  ModelStatsSelectedModel,
  ModelStatsSelectedOptions,
  ModelStatsSelectedPayload,
};

/** Centralized stage config for the LLM stats pipeline so matching, enrichment, pruning, and scoring tune from one place. */
export const LLM_STATS_STAGE_CONFIG = {
  matcher: {
    variantTokens: [
      "flash-lite",
      "flash",
      "pro",
      "nano",
      "mini",
      "lite",
      "max",
    ],
  },
  openrouter: {
    speedConcurrency: 8,
  },
  final: {
    nullFieldPruneThreshold: 0.5,
    nullFieldPruneRecentLookbackDays: 90,
  },
  scoring: {
    intelligenceBenchmarkKeys: [
      "omniscience_accuracy",
      "hle",
      "lcr",
      "scicode",
    ],
    agenticBenchmarkKeys: [
      "omniscience_nonhallucination_rate",
      "gdpval_normalized",
      "ifbench",
      "terminalbench_hard",
    ],
    defaultSpeedOutputTokenAnchors: [200, 500, 1_000, 2_000, 8_000],
    speedOutputTokenRangeMin: 200,
    speedOutputTokenRangeMax: 8_000,
    speedAnchorQuantiles: [0.25, 0.5, 0.75],
    weightedPriceInputRatio: 0.75,
    weightedPriceOutputRatio: 0.25,
  },
} satisfies LlmStatsStageConfig;

/** Persist the final model stats payload to disk while keeping write failures non-fatal. */
export async function saveModelStatsSelected(
  payload: ModelStatsSelectedPayload,
  outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
  await saveModelStatsSelectedToPath(payload, outputPath);
}

/** Return an empty selected LLM stats payload for failure-safe fallback paths. */
function emptyModelStatsSelectedPayload(): ModelStatsSelectedPayload {
  return {
    fetched_at_epoch_seconds: null,
    models: [],
  };
}

/** Build the selected LLM stats payload from the live pipeline. */
async function buildModelStatsSelectedPayload(
  modelId: string | null = null,
): Promise<ModelStatsSelectedPayload> {
  const sourceData = await fetchSourceData();
  const matchedRows = await buildMatchedRows(
    sourceData,
    LLM_STATS_STAGE_CONFIG.matcher,
  );
  const enrichedRows = await enrichRows(
    matchedRows,
    LLM_STATS_STAGE_CONFIG.openrouter,
    LLM_STATS_STAGE_CONFIG.scoring,
  );
  const models = buildFinalModels(
    enrichedRows,
    modelId,
    LLM_STATS_STAGE_CONFIG.final,
    LLM_STATS_STAGE_CONFIG.scoring,
  );
  const fetchedAt = currentEpochSeconds();
  return {
    fetched_at_epoch_seconds: fetchedAt,
    models,
  };
}

/** Build the selected LLM stats payload with configurable cache policy. */
async function getModelStatsSelectedPayload(
  options: ModelStatsSelectedOptions = {},
  useCache: boolean,
  saveCache: boolean,
): Promise<ModelStatsSelectedPayload> {
  try {
    if (useCache && options.id == null) {
      const cachedPayload =
        await loadModelStatsSelectedFromCache(DEFAULT_OUTPUT_PATH);
      if (cachedPayload) {
        return cachedPayload;
      }
    }

    const payload = await buildModelStatsSelectedPayload(options.id ?? null);
    if (saveCache && options.id == null) {
      await saveModelStatsSelected(payload, DEFAULT_OUTPUT_PATH);
    }
    return payload;
  } catch {
    return emptyModelStatsSelectedPayload();
  }
}

/** Build the final selected LLM stats payload with cache-first list mode and in-memory single-model mode. */
export async function getModelStatsSelected(
  options: ModelStatsSelectedOptions = {},
): Promise<ModelStatsSelectedPayload> {
  return getModelStatsSelectedPayload(options, true, true);
}

/** Build the final selected LLM stats payload from live sources without using cache. */
export async function getModelStatsSelectedLive(
  options: ModelStatsSelectedOptions = {},
): Promise<ModelStatsSelectedPayload> {
  return getModelStatsSelectedPayload(options, false, false);
}
