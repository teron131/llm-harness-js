/** Models.dev source helpers for recent model stats. */

import { fetchWithTimeout, nowEpochSeconds } from "../../utils";

const MODELS_DEV_URL = "https://models.dev/api.json";
const VERCEL_AI_GATEWAY_MODELS_URL = "https://vercel.com/ai-gateway/models";
const LOOKBACK_DAYS = 365;
const REQUEST_TIMEOUT_MS = 30_000;
const VERCEL_PROVIDER_ID = "vercel";
const VERCEL_PROVIDER_NAME = "Vercel AI Gateway";
const VERCEL_GATEWAY_MODEL_PATTERN =
	/\\"displayName\\":\\"([^\\"]*)\\",\\"creatorOrganization\\":\\"[^\\"]*\\",\\"copyString\\":\\"([^\\"]+)\\",[\s\S]*?\\"releaseDate\\":\\"([^\\"]*)\\"/g;

type ModelRecord = {
	id?: string;
	name?: string;
	family?: string;
	release_date?: string;
	last_updated?: string;
	open_weights?: boolean;
	reasoning?: boolean;
	tool_call?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
		output_audio?: number;
	};
	limit?: {
		context?: number;
		output?: number;
	};
	modalities?: {
		input?: string[];
		output?: string[];
	};
	[key: string]: unknown;
};

type ProviderRecord = {
	id?: string;
	name?: string;
	api?: string;
	models?: Record<string, ModelRecord>;
	[key: string]: unknown;
};

type ModelsDevPayload = Record<string, ProviderRecord>;

type ModelsDevFlatModel = {
	provider_id: string;
	provider_name: string;
	model_id: string;
	model: ModelRecord;
};

type ModelsDevSourcePayload = {
	fetched_at_epoch_seconds: number | null;
	status_code: number | null;
	payload: ModelsDevPayload;
};

type VercelGatewayModelRecord = {
	display_name: string;
	model_id: string;
	release_date: string | null;
};

/**
 * Normalized models.dev response after flattening and ranking.
 *
 * When fetching fails, `fetched_at_epoch_seconds` and `status_code` are `null`
 * and `models` is an empty array.
 */
type ModelsDevOutputPayload = {
	fetched_at_epoch_seconds: number | null;
	status_code: number | null;
	models: ModelsDevFlatModel[];
};

/**
 * models.dev source options.
 *
 * Reserved for future extension.
 */
export type ModelsDevOptions = Record<string, never>;
/** Helper for iso date days ago. */

function isoDateDaysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
}
/** Return whether the current value is valid for Models.dev source recent model stats. */

function isRecentDate(
	isoDate: string | undefined,
	cutoffIsoDate: string,
): boolean {
	if (!isoDate) {
		return false;
	}
	return isoDate >= cutoffIsoDate;
}
/** Convert the input into a finite number for Models.dev source recent model stats. */

function asFiniteNumber(value: unknown): number | null {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
}
/** Return whether the current value is a sentinel string from upstream page markup. */

function isSentinelString(value: string | null | undefined): boolean {
	return !value || value === "$undefined";
}
/** Build one Vercel-backed model record, preferring the live page name and keeping models.dev metadata. */

function buildVercelModelRecord(
	model: VercelGatewayModelRecord,
	fallbackModel: ModelRecord | undefined,
): ModelRecord {
	return {
		...fallbackModel,
		id: model.model_id,
		name: model.display_name || fallbackModel?.name || model.model_id,
		release_date: model.release_date ?? fallbackModel?.release_date,
		last_updated: model.release_date ?? fallbackModel?.last_updated,
	};
}
/** Extract live Vercel AI Gateway models from the public catalog page. */

function extractVercelGatewayModels(html: string): VercelGatewayModelRecord[] {
	const matches = [...html.matchAll(VERCEL_GATEWAY_MODEL_PATTERN)];
	const byModelId = new Map<string, VercelGatewayModelRecord>();

	for (const match of matches) {
		const [, displayName, modelId, releaseDate] = match;
		if (!modelId) {
			continue;
		}
		byModelId.set(modelId, {
			display_name: displayName ?? modelId,
			model_id: modelId,
			release_date: isSentinelString(releaseDate)
				? null
				: (releaseDate ?? null),
		});
	}

	return [...byModelId.values()];
}
/** Fetch the Vercel AI Gateway models page and normalize it into models.dev-compatible rows. */

async function fetchVercelGatewayModels(): Promise<VercelGatewayModelRecord[]> {
	try {
		const response = await fetchWithTimeout(
			VERCEL_AI_GATEWAY_MODELS_URL,
			{},
			REQUEST_TIMEOUT_MS,
		);
		if (!response.ok) {
			throw new Error(`Vercel AI Gateway request failed: ${response.status}`);
		}
		return extractVercelGatewayModels(await response.text());
	} catch {
		return [];
	}
}
/** Merge the live Vercel model list into the models.dev provider catalog. */

function mergeVercelProvider(
	payload: ModelsDevPayload,
	liveVercelModels: VercelGatewayModelRecord[],
): ModelsDevPayload {
	const existingVercelProvider = payload[VERCEL_PROVIDER_ID];
	const existingVercelModels = existingVercelProvider?.models ?? {};
	if (liveVercelModels.length === 0) {
		return payload;
	}

	const mergedVercelModels = Object.fromEntries(
		liveVercelModels.map((model) => [
			model.model_id,
			buildVercelModelRecord(model, existingVercelModels[model.model_id]),
		]),
	);

	return {
		...payload,
		[VERCEL_PROVIDER_ID]: {
			...existingVercelProvider,
			id: VERCEL_PROVIDER_ID,
			name: existingVercelProvider?.name ?? VERCEL_PROVIDER_NAME,
			models: mergedVercelModels,
		},
	};
}
/** Fetch and cache Models.dev source recent model stats data. */

async function fetchModelsDev(): Promise<ModelsDevSourcePayload> {
	const [response, liveVercelModels] = await Promise.all([
		fetchWithTimeout(MODELS_DEV_URL, {}, REQUEST_TIMEOUT_MS),
		fetchVercelGatewayModels(),
	]);

	if (!response.ok) {
		throw new Error(`models.dev request failed: ${response.status}`);
	}

	const payload = mergeVercelProvider(
		(await response.json()) as ModelsDevPayload,
		liveVercelModels,
	);
	const sourcePayload: ModelsDevSourcePayload = {
		fetched_at_epoch_seconds: nowEpochSeconds(),
		status_code: response.status,
		payload,
	};
	return sourcePayload;
}
/** Flatten nested rows for Models.dev source recent model stats. */

function flattenModels(payload: ModelsDevPayload): ModelsDevFlatModel[] {
	const rows: ModelsDevFlatModel[] = [];
	for (const [providerId, provider] of Object.entries(payload)) {
		const providerName = provider.name ?? providerId;
		const models = provider.models ?? {};
		for (const [modelId, model] of Object.entries(models)) {
			rows.push({
				provider_id: providerId,
				provider_name: providerName,
				model_id: model.id ?? modelId,
				model,
			});
		}
	}
	return rows;
}
/** Rank the recent models. */

function rankRecentModels(
	models: ModelsDevFlatModel[],
	cutoffIsoDate: string,
): ModelsDevFlatModel[] {
	return models
		.filter((row) => isRecentDate(row.model.release_date, cutoffIsoDate))
		.sort((left, right) => {
			const leftOutputCost =
				asFiniteNumber(left.model.cost?.output) ?? Number.POSITIVE_INFINITY;
			const rightOutputCost =
				asFiniteNumber(right.model.cost?.output) ?? Number.POSITIVE_INFINITY;
			if (leftOutputCost !== rightOutputCost) {
				return leftOutputCost - rightOutputCost;
			}
			return (right.model.release_date ?? "").localeCompare(
				left.model.release_date ?? "",
			);
		});
}

/**
 * Fetch, flatten, and rank recent models from models.dev.
 *
 * This API is failure-safe by design and returns an empty payload on errors.
 */
export async function getModelsDevStats(
	_options: ModelsDevOptions = {},
): Promise<ModelsDevOutputPayload> {
	try {
		const sourcePayload = await fetchModelsDev();
		const cutoffIsoDate = isoDateDaysAgo(LOOKBACK_DAYS);
		return {
			fetched_at_epoch_seconds: sourcePayload.fetched_at_epoch_seconds,
			status_code: sourcePayload.status_code,
			models: rankRecentModels(
				flattenModels(sourcePayload.payload),
				cutoffIsoDate,
			),
		};
	} catch {
		return {
			fetched_at_epoch_seconds: null,
			status_code: null,
			models: [],
		};
	}
}
