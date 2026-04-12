/** Cache helpers for selected image stats payloads. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	isFreshEpochSeconds,
	nowEpochSeconds,
	writeJsonFile,
} from "../../utils";
import type { ImageStatsSelectedPayload } from "./types";

export const DEFAULT_OUTPUT_PATH = resolve(".cache/image_stats.json");
const CACHE_TTL_SECONDS = 60 * 60 * 24;
/** Return the current Unix epoch time in seconds. */

export function currentEpochSeconds(): number {
	return nowEpochSeconds();
}
/** Write Cache selected image stats payloads data to disk. */

export async function saveImageStatsSelectedToPath(
	payload: ImageStatsSelectedPayload,
	outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
	try {
		await writeJsonFile(outputPath, payload);
	} catch {
		// Intentionally swallow cache write errors: API remains in-memory first.
	}
}
/** Load Cache selected image stats payloads data from cache. */

export async function loadImageStatsSelectedFromCache(
	outputPath: string,
): Promise<ImageStatsSelectedPayload | null> {
	try {
		const content = await readFile(outputPath, "utf-8");
		const payload = JSON.parse(content) as ImageStatsSelectedPayload;
		if (!Array.isArray(payload.models)) {
			return null;
		}
		if (
			!isFreshEpochSeconds(payload.fetched_at_epoch_seconds, CACHE_TTL_SECONDS)
		) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}
