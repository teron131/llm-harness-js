/** Source stage for LLM stats: fetch Artificial Analysis scraper rows and build lookup maps. */

import {
	FALLBACK_PROVIDER_IDS,
	modelSlugFromModelId,
	PRIMARY_PROVIDER_ID,
} from "../shared";
import { getArtificialAnalysisScrapedEvalsOnlyStats } from "../sources/artificial-analysis-scraper";
import { getModelsDevStats } from "../sources/models-dev";

import type {
	ArtificialAnalysisModel,
	ModelsDevModel,
	SourceData,
} from "./types";

/** Keep one preferred models.dev row per model id with OpenRouter first and trusted providers as fallback. */
function dedupePreferredProviderModels(
	modelsDevModels: ModelsDevModel[],
): ModelsDevModel[] {
	const preferredModels = modelsDevModels.filter(
		(modelsDevModel) =>
			modelsDevModel.provider_id === PRIMARY_PROVIDER_ID ||
			FALLBACK_PROVIDER_IDS.has(modelsDevModel.provider_id),
	);
	const byModelId = new Map<string, ModelsDevModel>();
	const withPriority = preferredModels.map((modelsDevModel) => ({
		modelsDevModel,
		priority: modelsDevModel.provider_id === PRIMARY_PROVIDER_ID ? 0 : 1,
	}));
	withPriority.sort((left, right) => left.priority - right.priority);
	for (const { modelsDevModel } of withPriority) {
		byModelId.set(
			modelsDevModel.model_id,
			byModelId.get(modelsDevModel.model_id) ?? modelsDevModel,
		);
	}
	return [...byModelId.values()];
}
/** Build the models dev by id. */

function buildModelsDevById(
	modelsDevModels: ModelsDevModel[],
): Map<string, ModelsDevModel> {
	return new Map(
		modelsDevModels.map((modelsDevModel) => [
			modelsDevModel.model_id,
			modelsDevModel,
		]),
	);
}
/** Build the Artificial Analysis rows by slug. */

function buildArtificialAnalysisBySlug(
	artificialAnalysisRows: unknown[],
): Map<string, ArtificialAnalysisModel> {
	const artificialAnalysisBySlug = new Map<string, ArtificialAnalysisModel>();
	for (const artificialAnalysisRow of artificialAnalysisRows) {
		const artificialAnalysisModel =
			artificialAnalysisRow as ArtificialAnalysisModel;
		const artificialAnalysisSlug = modelSlugFromModelId(
			artificialAnalysisModel.model_id,
		);
		if (artificialAnalysisSlug) {
			artificialAnalysisBySlug.set(
				artificialAnalysisSlug,
				artificialAnalysisModel,
			);
		}
	}
	return artificialAnalysisBySlug;
}
/** Fetch the source snapshots and precompute the slug/id maps used by later stages. */
export async function fetchSourceData(): Promise<SourceData> {
	const [artificialAnalysisScrapedStats, modelsDevStats] = await Promise.all([
		getArtificialAnalysisScrapedEvalsOnlyStats(),
		getModelsDevStats(),
	]);
	const preferredModelsDevModels = dedupePreferredProviderModels(
		modelsDevStats.models,
	);
	return {
		artificialAnalysisRows: artificialAnalysisScrapedStats.data,
		preferredModelsDevModels,
		modelsDevById: buildModelsDevById(preferredModelsDevModels),
		artificialAnalysisBySlug: buildArtificialAnalysisBySlug(
			artificialAnalysisScrapedStats.data,
		),
	};
}
