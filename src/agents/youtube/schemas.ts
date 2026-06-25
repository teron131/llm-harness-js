/** Structured output schemas for YouTube summarization. */

import { z } from "zod";

import { TagRangeSchema } from "../../tools/fs/fast-copy.js";
import { s2hk } from "../../utils/text-utils.js";

const ChapterSchema = z.object({
	title: z.string().transform((value) => s2hk(value)),
	description: z.string().transform((value) => s2hk(value)),
	start_time: z.string().optional().nullable(),
	end_time: z.string().optional().nullable(),
});

export const SummarySchema = z.object({
	overview: z.string().transform((value) => s2hk(value)),
	chapters: z.array(ChapterSchema).min(1),
});

export type Summary = z.output<typeof SummarySchema>;

export const GarbageIdentificationSchema = z.object({
	garbage_ranges: z.array(TagRangeSchema),
});

const RateSchema = z.object({
	rate: z.enum(["Fail", "Refine", "Pass"]),
	reason: z.string(),
});

export const QualitySchema = z.object({
	completeness: RateSchema,
	structure: RateSchema,
	no_garbage: RateSchema,
	meta_language_avoidance: RateSchema,
	useful_keywords: RateSchema,
	correct_language: RateSchema,
});

type Quality = z.infer<typeof QualitySchema>;

/** Return the quality ratings that contribute to the overall summary score. */
function qualityAspectRatings(quality: Quality) {
	return [
		quality.completeness,
		quality.structure,
		quality.no_garbage,
		quality.meta_language_avoidance,
		quality.useful_keywords,
		quality.correct_language,
	];
}

/** Return the weighted pass/refine percentage for one quality review. */
export function qualityScorePercent(quality: Quality): number {
	const aspects = qualityAspectRatings(quality);
	const passCount = aspects.filter((x) => x.rate === "Pass").length;
	const refineCount = aspects.filter((x) => x.rate === "Refine").length;
	return Math.floor((passCount * 100 + refineCount * 50) / aspects.length);
}

/** Return whether one quality review is good enough to stop refinement. */
export function isQualityAcceptable(quality: Quality): boolean {
	return qualityScorePercent(quality) >= 80;
}
