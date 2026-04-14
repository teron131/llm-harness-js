/** Public LLM stats API: cache list payloads, rebuild from live sources when needed, and return failure-safe output. */
import {
	currentEpochSeconds,
	DEFAULT_OUTPUT_PATH,
	loadModelStatsSelectedFromCache,
	saveModelStatsSelectedToPath,
} from "./llm-stats/cache";
import { buildFinalModels } from "./llm-stats/final-stage";
import { buildMatchedRows } from "./llm-stats/match-stage";
import { enrichRows } from "./llm-stats/openrouter-stage";
import { fetchSourceData } from "./llm-stats/source-stage";
import type {
	LlmStatsStageConfig,
	ModelStatsSelectedMetadata,
	ModelStatsSelectedModel,
	ModelStatsSelectedOptions,
	ModelStatsSelectedPayload,
} from "./llm-stats/types";
import { asRecord } from "./shared";

export type {
	LlmStatsStageConfig,
	ModelStatsSelectedMetadata,
	ModelStatsSelectedModel,
	ModelStatsSelectedOptions,
	ModelStatsSelectedPayload,
};

/** Centralized stage config for the LLM stats pipeline so matching, enrichment, pruning, and scoring tune from one place. */
const LLM_STATS_STAGE_CONFIG = {
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

function isListRequest(modelId: string | null | undefined): boolean {
	return modelId == null;
}

function sortedUniqueKeys(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function keysFromModelField(
	models: Array<Record<string, unknown> | ModelStatsSelectedModel>,
	field: "evaluations" | "intelligence",
): string[] {
	return sortedUniqueKeys(
		models.flatMap((model) => Object.keys(asRecord(model[field]))),
	);
}

function buildModelStatsSelectedMetadata(
	models: Array<Record<string, unknown> | ModelStatsSelectedModel>,
	scoringConfig: LlmStatsStageConfig["scoring"],
): ModelStatsSelectedMetadata {
	const availableEvaluationKeys = keysFromModelField(models, "evaluations");
	const availableIntelligenceKeys = keysFromModelField(models, "intelligence");
	const availableBenchmarkKeys = sortedUniqueKeys([
		...availableEvaluationKeys,
		...availableIntelligenceKeys,
	]);
	const selectedBenchmarkKeys = sortedUniqueKeys([
		...scoringConfig.intelligenceBenchmarkKeys,
		...scoringConfig.agenticBenchmarkKeys,
	]);
	return {
		artificial_analysis: {
			available_benchmark_keys: availableBenchmarkKeys,
			available_evaluation_keys: availableEvaluationKeys,
			available_intelligence_keys: availableIntelligenceKeys,
		},
		scoring: {
			intelligence_benchmark_keys: [...scoringConfig.intelligenceBenchmarkKeys],
			missing_intelligence_benchmark_keys:
				scoringConfig.intelligenceBenchmarkKeys.filter(
					(key) => !availableBenchmarkKeys.includes(key),
				),
			agentic_benchmark_keys: [...scoringConfig.agenticBenchmarkKeys],
			missing_agentic_benchmark_keys: scoringConfig.agenticBenchmarkKeys.filter(
				(key) => !availableBenchmarkKeys.includes(key),
			),
			selected_benchmark_keys: selectedBenchmarkKeys,
		},
	};
}

function withModelStatsSelectedMetadata(
	payload: Omit<ModelStatsSelectedPayload, "metadata"> &
		Partial<Pick<ModelStatsSelectedPayload, "metadata">>,
	modelsForMetadata: Array<
		Record<string, unknown> | ModelStatsSelectedModel
	> = payload.models,
): ModelStatsSelectedPayload {
	return {
		...payload,
		metadata:
			payload.metadata ??
			buildModelStatsSelectedMetadata(
				modelsForMetadata,
				LLM_STATS_STAGE_CONFIG.scoring,
			),
	};
}

/** Persist the final model stats payload to disk while keeping write failures non-fatal. */
export async function saveModelStatsSelected(
	payload: ModelStatsSelectedPayload,
	outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
	await saveModelStatsSelectedToPath(payload, outputPath);
}

/** Return an empty selected LLM stats payload for failure-safe fallback paths. */
function emptyModelStatsSelectedPayload(): ModelStatsSelectedPayload {
	return withModelStatsSelectedMetadata({
		fetched_at_epoch_seconds: null,
		models: [],
	});
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
	const models = await buildFinalModels(
		enrichedRows,
		modelId,
		LLM_STATS_STAGE_CONFIG.final,
		LLM_STATS_STAGE_CONFIG.scoring,
	);
	const fetchedAt = currentEpochSeconds();
	return withModelStatsSelectedMetadata(
		{
			fetched_at_epoch_seconds: fetchedAt,
			models,
		},
		enrichedRows.rows,
	);
}

/** Build the selected LLM stats payload with configurable cache policy. */
async function getModelStatsSelectedPayload(
	options: ModelStatsSelectedOptions = {},
	useCache: boolean,
	saveCache: boolean,
): Promise<ModelStatsSelectedPayload> {
	try {
		const modelId = options.id ?? null;
		const shouldUseListCache = useCache && isListRequest(modelId);
		const shouldSaveListCache = saveCache && isListRequest(modelId);

		if (shouldUseListCache) {
			const cachedPayload =
				await loadModelStatsSelectedFromCache(DEFAULT_OUTPUT_PATH);
			if (cachedPayload) {
				return withModelStatsSelectedMetadata(cachedPayload);
			}
		}

		const payload = await buildModelStatsSelectedPayload(modelId);
		if (shouldSaveListCache) {
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
