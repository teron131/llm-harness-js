/** Artificial Analysis API source helpers. */

import { fetchWithTimeout, nowEpochSeconds } from "../../utils";

const MODELS_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const REQUEST_TIMEOUT_MS = 30_000;

type ModelCreator = {
	name?: string;
	slug?: string;
};

type Evaluations = {
	artificial_analysis_intelligence_index?: number | null;
	artificial_analysis_coding_index?: number | null;
	hle?: number | null;
	terminalbench_hard?: number | null;
	lcr?: number | null;
	ifbench?: number | null;
	scicode?: number | null;
	[key: string]: unknown;
};

type BaseModel = {
	name?: string;
	slug?: string;
	release_date?: string;
	model_creator?: ModelCreator;
	evaluations?: Evaluations;
	[key: string]: unknown;
};

type ArtificialAnalysisModel = {
	name: string | null;
	slug: string | null;
	release_date: string | null;
	evaluations: Evaluations | null;
};

type SourcePayload = {
	fetched_at_epoch_seconds: number | null;
	status_code: number | null;
	models: BaseModel[];
};

/**
 * Lean Artificial Analysis models response used by matching and fallback merge paths.
 *
 * When fetching fails, `fetched_at_epoch_seconds` and `status_code` are `null`
 * and `models` is an empty array.
 */
type ArtificialAnalysisOutputPayload = {
	fetched_at_epoch_seconds: number | null;
	status_code: number | null;
	models: ArtificialAnalysisModel[];
};

/**
 * Artificial Analysis source options.
 */
export type ArtificialAnalysisOptions = { apiKey?: string };

/** Remove nested `id` fields from Artificial Analysis API rows. */
function removeIds<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => removeIds(item)) as T;
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([key]) => key !== "id")
				.map(([key, child]) => [key, removeIds(child)]),
		) as T;
	}
	return value;
}

/** Project the raw AA API row down to the fields used by this repo. */
function slimModel(model: BaseModel): ArtificialAnalysisModel {
	return {
		name: typeof model.name === "string" ? model.name : null,
		slug: typeof model.slug === "string" ? model.slug : null,
		release_date:
			typeof model.release_date === "string" ? model.release_date : null,
		evaluations: model.evaluations ?? null,
	};
}

/** Fetch raw model rows from the Artificial Analysis API. */
async function fetchModels(apiKey: string | undefined): Promise<SourcePayload> {
	if (!apiKey) {
		throw new Error("Missing ARTIFICIALANALYSIS_API_KEY.");
	}

	const response = await fetchWithTimeout(
		MODELS_URL,
		{
			headers: { "x-api-key": apiKey },
		},
		REQUEST_TIMEOUT_MS,
	);

	if (!response.ok) {
		throw new Error(`Artificial Analysis request failed: ${response.status}`);
	}

	const payload = (await response.json()) as { data: BaseModel[] };
	return {
		fetched_at_epoch_seconds: nowEpochSeconds(),
		status_code: response.status,
		models: payload.data.map((model) => removeIds(model)),
	};
}

/** Fetch the lean Artificial Analysis API shape used by this repo. */
export async function getArtificialAnalysisStats(
	options: ArtificialAnalysisOptions = {},
): Promise<ArtificialAnalysisOutputPayload> {
	try {
		const apiKey = options.apiKey ?? process.env.ARTIFICIALANALYSIS_API_KEY;
		const sourcePayload = await fetchModels(apiKey);
		return {
			fetched_at_epoch_seconds: sourcePayload.fetched_at_epoch_seconds,
			status_code: sourcePayload.status_code,
			models: sourcePayload.models.map(slimModel),
		};
	} catch {
		return {
			fetched_at_epoch_seconds: null,
			status_code: null,
			models: [],
		};
	}
}
