/** Matching-stage helpers for LLM stats selection. */

/** Match stage for LLM stats: turn scraper-first matcher diagnostics into merged source rows. */
import { getScraperFallbackMatchDiagnostics } from "../matcher";
import {
	asRecord,
	modelSlugFromModelId,
	normalizeProviderModelId,
} from "../shared";

import type {
	ArtificialAnalysisModel,
	MatcherConfig,
	ModelsDevModel,
	SourceData,
} from "./types";

/** Return whether Matching-stage LLM stats selection has a matching token. */

function hasToken(id: string, token: string) {
	return id.includes(token);
}
/** Helper for canonical model id. */

function canonicalModelId(
	modelId: unknown,
	providerId: unknown,
	fallbackModelId: unknown,
): string | null {
	if (typeof modelId === "string" && modelId.includes("/")) {
		return modelId;
	}
	if (typeof providerId === "string" && typeof modelId === "string") {
		return `${providerId}/${modelId}`;
	}
	if (typeof providerId === "string" && typeof fallbackModelId === "string") {
		return `${providerId}/${fallbackModelId}`;
	}
	return typeof modelId === "string" ? modelId : null;
}
/** Return whether Matching-stage LLM stats selection has a variant conflict. */

function hasVariantConflict(
	artificialAnalysisSlug: string,
	matchedModelId: string,
	matcherConfig: MatcherConfig,
): boolean {
	const aa = normalizeProviderModelId(artificialAnalysisSlug);
	const matched = normalizeProviderModelId(matchedModelId);
	return matcherConfig.variantTokens.some(
		(token) => hasToken(aa, token) !== hasToken(matched, token),
	);
}

/** Build one matched row from the Artificial Analysis source model. */
function buildMatchedRowFromArtificialAnalysisModel(
	artificialAnalysisModel: ArtificialAnalysisModel,
	matchedModelId: string,
	modelsDevById: Map<string, ModelsDevModel>,
): Record<string, unknown> {
	const artificialAnalysisModelId =
		typeof artificialAnalysisModel.model_id === "string"
			? artificialAnalysisModel.model_id
			: null;
	const artificialAnalysisSlug = modelSlugFromModelId(
		artificialAnalysisModelId,
	);
	const evaluations = asRecord(artificialAnalysisModel.evaluations);
	const intelligence = asRecord(artificialAnalysisModel.intelligence);
	const intelligenceIndexCost = asRecord(
		artificialAnalysisModel.intelligence_index_cost,
	);
	const logo =
		typeof artificialAnalysisModel.logo === "string"
			? artificialAnalysisModel.logo
			: null;
	const matchedModelsDev = modelsDevById.get(matchedModelId) ?? null;
	const matchedModelFields = asRecord(matchedModelsDev?.model);
	const canonicalId = canonicalModelId(
		matchedModelsDev?.model?.id ?? matchedModelId,
		matchedModelsDev?.provider_id,
		matchedModelsDev?.model_id,
	);
	const {
		id: _matchedId,
		name: _matchedName,
		family: matchedFamily,
		model_id: _matchedModelId,
		slug: _matchedSlug,
		...matchedModelFieldsWithoutIdFamilyAndModelRefs
	} = matchedModelFields;

	return {
		id: canonicalId,
		provider_id: matchedModelsDev?.provider_id ?? null,
		openrouter_id: matchedModelsDev?.model?.id ?? null,
		name:
			typeof matchedModelsDev?.model?.name === "string"
				? matchedModelsDev.model.name
				: artificialAnalysisModelId,
		aa_id: artificialAnalysisModelId,
		aa_slug: artificialAnalysisSlug,
		family: matchedFamily,
		logo,
		...matchedModelFieldsWithoutIdFamilyAndModelRefs,
		evaluations,
		intelligence,
		intelligence_index_cost: intelligenceIndexCost,
	};
}

/** Build matched intermediate rows by running scraper fallback diagnostics and rejecting obvious variant mismatches. */
export async function buildMatchedRows(
	sourceData: SourceData,
	matcherConfig: MatcherConfig,
): Promise<Record<string, unknown>[]> {
	const fallbackDiagnostics = await getScraperFallbackMatchDiagnostics({
		scrapedRows: sourceData.artificialAnalysisRows,
		modelsDevModels: sourceData.preferredModelsDevModels,
	});

	return fallbackDiagnostics.models
		.map((matchedModel) => {
			const matchedModelId = matchedModel.best_match?.model_id;
			if (typeof matchedModelId !== "string" || matchedModelId.length === 0) {
				return null;
			}
			if (
				hasVariantConflict(
					matchedModel.artificial_analysis_slug,
					matchedModelId,
					matcherConfig,
				)
			) {
				return null;
			}
			const artificialAnalysisModel = sourceData.artificialAnalysisBySlug.get(
				matchedModel.artificial_analysis_slug,
			);
			if (!artificialAnalysisModel) {
				return null;
			}
			return buildMatchedRowFromArtificialAnalysisModel(
				artificialAnalysisModel,
				matchedModelId,
				sourceData.modelsDevById,
			);
		})
		.filter((row): row is Record<string, unknown> => row != null);
}
