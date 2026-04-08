/** Source-stage helpers for image stats selection. */

import { getArenaAiImageStats } from "../sources/arena-ai";
import { getArtificialAnalysisImageStats } from "../sources/artificial-analysis";

import type { ImageSourceData } from "./types";
/** Fetch source rows for Source-stage image stats selection. */

export async function fetchSourceData(): Promise<ImageSourceData> {
    const [artificialAnalysisPayload, arenaPayload] = await Promise.all([
        getArtificialAnalysisImageStats(),
        getArenaAiImageStats(),
    ]);
    const artificialAnalysisModels = artificialAnalysisPayload.data ?? [];
    const arenaModels = arenaPayload.rows ?? [];

    return {
        artificialAnalysisPayload,
        arenaPayload,
        artificialAnalysisModelsBySlug: new Map(
            artificialAnalysisModels
                .filter((model) => typeof model.slug === "string")
                .map((model) => [model.slug as string, model]),
        ),
        arenaModelsByName: new Map(
            arenaModels.map((model) => [model.model, model]),
        ),
    };
}
