/** Gemini-backed YouTube summarization helpers. */

import { GoogleGenAI, Type } from "@google/genai";

import { trackUsage } from "../../clients/usage.js";
import { getGeminiSummaryPrompt } from "./prompts.js";
import { type Summary, SummarySchema } from "./schemas.js";

const DEFAULT_MODEL = "gemini-3-flash-preview";

const USD_PER_M_TOKENS_BY_MODEL: Record<
	string,
	{ input: number; output: number }
> = {
	"gemini-3-flash-preview": { input: 0.5, output: 3 },
	"gemini-3-pro-preview": { input: 2, output: 12 },
};

type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export type GeminiSummarizeVideoOptions = {
	videoUrl: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	targetLanguage?: string;
	apiKey?: string;
};

type AnalyzeVideoUrlOptions = GeminiSummarizeVideoOptions & {
	timeout?: number;
};

const SUMMARY_RESPONSE_SCHEMA = {
	type: Type.OBJECT,
	properties: {
		overview: { type: Type.STRING },
		chapters: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					title: { type: Type.STRING },
					description: { type: Type.STRING },
					start_time: {
						type: Type.STRING,
						nullable: true,
					},
					end_time: {
						type: Type.STRING,
						nullable: true,
					},
				},
				required: ["title", "description"],
			},
		},
	},
	required: ["overview", "chapters"],
};

function resolveGeminiApiKey(apiKey?: string): string {
	const resolvedApiKey =
		apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
	if (!resolvedApiKey) {
		throw new Error("API key not found. Set GOOGLE_API_KEY or GEMINI_API_KEY");
	}
	return resolvedApiKey;
}

function thinkingBudgetFor(level: ThinkingLevel): number {
	return level === "high" ? -1 : 0;
}
/** Compute the cost for the current request. */

function calculateCost(
	model: string,
	promptTokens: number,
	totalTokens: number,
): number {
	const pricing = USD_PER_M_TOKENS_BY_MODEL[model];
	if (!pricing) {
		return 0;
	}
	const outputTokens = Math.max(0, totalTokens - promptTokens);
	return (
		(promptTokens / 1_000_000) * pricing.input +
		(outputTokens / 1_000_000) * pricing.output
	);
}

function trackGeminiUsage(
	model: string,
	usage:
		| {
				promptTokenCount?: number;
				totalTokenCount?: number;
		  }
		| null
		| undefined,
) {
	if (
		usage?.promptTokenCount === undefined ||
		usage.totalTokenCount === undefined
	) {
		return;
	}

	const cost = calculateCost(
		model,
		usage.promptTokenCount,
		usage.totalTokenCount,
	);
	trackUsage(
		usage.promptTokenCount,
		usage.totalTokenCount - usage.promptTokenCount,
		cost,
	);
}
/** Analyze a YouTube video URL with Gemini. */

async function analyzeVideoUrl({
	videoUrl,
	model = DEFAULT_MODEL,
	thinkingLevel = "medium",
	targetLanguage = "auto",
	apiKey,
	timeout = 600,
}: AnalyzeVideoUrlOptions): Promise<Summary | null> {
	const client = new GoogleGenAI({ apiKey: resolveGeminiApiKey(apiKey) });

	try {
		const response = await client.models.generateContent({
			model,
			contents: [
				{
					fileData: {
						fileUri: videoUrl,
					},
				},
				{
					text: getGeminiSummaryPrompt(targetLanguage),
				},
			],
			config: {
				httpOptions: { timeout: timeout * 1000 },
				thinkingConfig: {
					thinkingBudget: thinkingBudgetFor(thinkingLevel),
				},
				responseMimeType: "application/json",
				responseSchema: SUMMARY_RESPONSE_SCHEMA,
			},
		});

		const text = response.text;
		if (!text) {
			return null;
		}

		const analysis = SummarySchema.parse(JSON.parse(text));

		trackGeminiUsage(model, response.usageMetadata);

		return analysis;
	} catch {
		return null;
	}
}
/** Summarize a YouTube video with Gemini. */

export function summarizeVideo({
	videoUrl,
	model = DEFAULT_MODEL,
	thinkingLevel = "medium",
	targetLanguage = "auto",
	apiKey,
}: GeminiSummarizeVideoOptions): Promise<Summary | null> {
	return analyzeVideoUrl({
		videoUrl,
		model,
		thinkingLevel,
		targetLanguage,
		...(apiKey ? { apiKey } : {}),
	});
}
