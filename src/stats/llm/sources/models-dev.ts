/** Models.dev source helpers for recent model stats. */

import { fetchWithTimeout, nowEpochSeconds } from "../../utils";

const MODELS_DEV_URL = "https://models.dev/api.json";
const LOOKBACK_DAYS = 365;
const REQUEST_TIMEOUT_MS = 30_000;

type NumberOrNull = number | null;

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

function asFiniteNumber(value: unknown): NumberOrNull {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
/** Fetch and cache Models.dev source recent model stats data. */

async function fetchModelsDev(): Promise<ModelsDevSourcePayload> {
  const response = await fetchWithTimeout(
    MODELS_DEV_URL,
    {},
    REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`models.dev request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ModelsDevPayload;
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
