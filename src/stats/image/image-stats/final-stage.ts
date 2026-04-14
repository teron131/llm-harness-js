/** Final-stage helpers for image stats selection. */

import { resolveStatsLogo } from "../../logo";
import { cacheStatsLogos } from "../../logo-cache";
import { asRecord, type JsonObject, meanOrNull } from "../../utils";

import type { ImageStatsSelectedModel, ImageUnionRow } from "./types";

/** Normalize a model record to its id for Final-stage image stats selection. */

function toModelId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[._:/\s]+/g, "-")
		.replace(/[^a-z0-9-]+/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}
/** Resolve the provider for Final-stage image stats selection. */

function providerFromArenaProvider(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const left = value.split("·")[0]?.trim();
	return left && left.length > 0 ? left : null;
}

function recordOrNull(record: JsonObject): JsonObject | null {
	return Object.keys(record).length > 0 ? record : null;
}

function preferredString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

function providerFromArtificialAnalysis(
	artificialAnalysis: JsonObject,
): string | null {
	const modelCreator = asRecord(artificialAnalysis.model_creator);
	return typeof modelCreator.name === "string" ? modelCreator.name : null;
}
/** Build the logo field for Final-stage image stats selection. */

function buildLogo(model: JsonObject, provider: string | null): string {
	const artificialAnalysis = asRecord(model.artificial_analysis);
	const modelCreator = asRecord(artificialAnalysis.model_creator);
	return resolveStatsLogo({
		provider,
		explicitLogo:
			typeof modelCreator.logo === "string"
				? modelCreator.logo
				: typeof artificialAnalysis.logo === "string"
					? artificialAnalysis.logo
					: null,
	});
}
/** Select the relevant score fields for Final-stage image stats selection. */

function pickArtificialAnalysisPercentiles(
	model: JsonObject,
): JsonObject | null {
	return recordOrNull(
		asRecord(asRecord(model.artificial_analysis).percentiles),
	);
}
/** Select the relevant score fields for Final-stage image stats selection. */

function pickArenaPercentiles(model: JsonObject): JsonObject | null {
	return recordOrNull(asRecord(asRecord(model.arena_ai).percentiles));
}
/** Select the relevant score fields for Final-stage image stats selection. */

function pickArtificialAnalysisScores(model: JsonObject): JsonObject | null {
	return recordOrNull(
		asRecord(asRecord(model.artificial_analysis).weighted_scores),
	);
}
/** Select the relevant score fields for Final-stage image stats selection. */

function pickArenaScores(model: JsonObject): JsonObject | null {
	return recordOrNull(asRecord(asRecord(model.arena_ai).weighted_scores));
}
/** Map a source model into the selected Final-stage image stats selection payload. */

function mapUnionModelToSelected(
	unionModel: ImageUnionRow,
): ImageStatsSelectedModel {
	const model = unionModel as unknown as JsonObject;
	const artificialAnalysis = asRecord(model.artificial_analysis);
	const arena = asRecord(model.arena_ai);
	const artificialAnalysisScores = pickArtificialAnalysisScores(model);
	const arenaScores = pickArenaScores(model);
	const artificialAnalysisPercentiles =
		pickArtificialAnalysisPercentiles(model);
	const arenaPercentiles = pickArenaPercentiles(model);
	const bestMatch = asRecord(model.best_match);
	const modelName = preferredString(
		artificialAnalysis.name,
		artificialAnalysis.slug,
		arena.model,
		bestMatch.arena_model,
	);
	const inferredId = toModelId(modelName ?? "unknown");
	const provider =
		providerFromArtificialAnalysis(artificialAnalysis) ??
		providerFromArenaProvider(arena.provider);

	const photorealisticScore = meanOrNull([
		artificialAnalysisScores?.photorealistic,
		arenaScores?.photorealistic,
	]);
	const illustrativeScore = meanOrNull([
		artificialAnalysisScores?.illustrative,
		arenaScores?.illustrative,
	]);
	const contextualScore = meanOrNull([
		artificialAnalysisScores?.contextual,
		arenaScores?.contextual,
	]);
	const overallScore = meanOrNull([
		photorealisticScore,
		illustrativeScore,
		contextualScore,
	]);
	const photorealisticPercentile = meanOrNull([
		artificialAnalysisPercentiles?.photorealistic_percentile,
		arenaPercentiles?.photorealistic_percentile,
	]);
	const illustrativePercentile = meanOrNull([
		artificialAnalysisPercentiles?.illustrative_percentile,
		arenaPercentiles?.illustrative_percentile,
	]);
	const contextualPercentile = meanOrNull([
		artificialAnalysisPercentiles?.contextual_percentile,
		arenaPercentiles?.contextual_percentile,
	]);
	const overallPercentile = meanOrNull([
		photorealisticPercentile,
		illustrativePercentile,
		contextualPercentile,
	]);

	return {
		id: inferredId.length > 0 ? inferredId : null,
		name: modelName,
		provider: provider ?? null,
		logo: buildLogo(model, provider),
		release_date:
			typeof artificialAnalysis.release_date === "string"
				? artificialAnalysis.release_date
				: null,
		sources: {
			artificial_analysis: Object.keys(artificialAnalysis).length > 0,
			arena_ai: Object.keys(arena).length > 0,
		},
		source_scores: {
			artificial_analysis: artificialAnalysisScores,
			arena_ai: arenaScores,
		},
		source_percentiles: {
			artificial_analysis: artificialAnalysisPercentiles,
			arena_ai: arenaPercentiles,
		},
		scores: {
			photorealistic_score: photorealisticScore,
			illustrative_score: illustrativeScore,
			contextual_score: contextualScore,
			overall_score: overallScore,
		},
		percentiles: {
			photorealistic_percentile: photorealisticPercentile,
			illustrative_percentile: illustrativePercentile,
			contextual_percentile: contextualPercentile,
			overall_percentile: overallPercentile,
		},
	};
}
/** Filter the models by id. */

function filterModelsById(
	models: ImageStatsSelectedModel[],
	id: string | null | undefined,
): ImageStatsSelectedModel[] {
	return id == null ? models : models.filter((model) => model.id === id);
}
/** Build the final Final-stage image stats selection payload. */

export async function buildFinalModels(
	unionModels: ImageUnionRow[],
	id?: string | null,
): Promise<ImageStatsSelectedModel[]> {
	const selectedModels = unionModels
		.map(mapUnionModelToSelected)
		.sort(
			(left, right) =>
				(right.scores.overall_score ?? Number.NEGATIVE_INFINITY) -
				(left.scores.overall_score ?? Number.NEGATIVE_INFINITY),
		);
	return cacheStatsLogos(filterModelsById(selectedModels, id));
}
