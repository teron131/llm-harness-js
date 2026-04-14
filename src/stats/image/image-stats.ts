/** Stats pipeline helpers. */

/** Public image stats API: cache list payloads, rebuild from live sources when needed, and return failure-safe output. */
import {
	currentEpochSeconds,
	DEFAULT_OUTPUT_PATH,
	loadImageStatsSelectedFromCache,
	saveImageStatsSelectedToPath,
} from "./image-stats/cache";
import { buildFinalModels } from "./image-stats/final-stage";
import { buildMatchedRows } from "./image-stats/match-stage";
import { fetchSourceData } from "./image-stats/source-stage";
import type {
	ImageStatsSelectedModel,
	ImageStatsSelectedOptions,
	ImageStatsSelectedPayload,
} from "./image-stats/types";

export type {
	ImageStatsSelectedModel,
	ImageStatsSelectedOptions,
	ImageStatsSelectedPayload,
};

function isListRequest(modelId: string | null | undefined): boolean {
	return modelId == null;
}
/** Save the selected Stats pipeline payload. */

export async function saveImageStatsSelected(
	payload: ImageStatsSelectedPayload,
	outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
	await saveImageStatsSelectedToPath(payload, outputPath);
}
/** Return the selected Stats pipeline payload. */

export async function getImageStatsSelected(
	options: ImageStatsSelectedOptions = {},
): Promise<ImageStatsSelectedPayload> {
	try {
		const modelId = options.id ?? null;

		if (isListRequest(modelId)) {
			const cachedPayload =
				await loadImageStatsSelectedFromCache(DEFAULT_OUTPUT_PATH);
			if (cachedPayload) {
				return cachedPayload;
			}
		}

		const sourceData = await fetchSourceData();
		const matchedRows = await buildMatchedRows(sourceData);
		const models = await buildFinalModels(matchedRows, modelId);
		const fetchedAt = currentEpochSeconds();

		if (!isListRequest(modelId)) {
			return {
				fetched_at_epoch_seconds: fetchedAt,
				models,
			};
		}

		const listPayload: ImageStatsSelectedPayload = {
			fetched_at_epoch_seconds: fetchedAt,
			models,
		};
		await saveImageStatsSelected(listPayload, DEFAULT_OUTPUT_PATH);
		return listPayload;
	} catch {
		return {
			fetched_at_epoch_seconds: null,
			models: [],
		};
	}
}
