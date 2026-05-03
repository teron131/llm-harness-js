/** Agent helpers for model orchestration. */

import type { ClientTool, ServerTool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import type { ZodType, z } from "zod";

import { MediaMessage } from "../clients/multimodal.js";
import { ChatOpenAI } from "../clients/openai.js";
import { webloaderTool } from "../tools/web/webloader.js";
import { fixFile as runFixFile, fixText as runFixText } from "./fixer/fixer.js";
import { DEFAULT_FIXER_TASK_PROMPT } from "./fixer/prompts.js";
import { DEFAULT_FIXER_MAX_ITERATIONS } from "./fixer/state.js";
import type { Summary } from "./youtube/schemas.js";
import { summarizeVideo as summarizeVideoLite } from "./youtube/summarizer.js";
import { summarizeVideo as summarizeVideoGemini } from "./youtube/summarizer-gemini.js";
import { summarizeVideo as summarizeVideoReact } from "./youtube/summarizer-react.js";

type GenericTool = ClientTool | ServerTool;
type AgentModel = ReturnType<typeof ChatOpenAI>;
type AgentInstance = ReturnType<typeof createAgent>;
type AgentInvokeInput = Parameters<AgentInstance["invoke"]>[0];
type AgentResponse<T extends ZodType | null> = {
	messages: unknown[];
	structuredResponse?: T extends ZodType ? z.output<T> : never;
};
type AgentOutput<T extends ZodType | null> = T extends ZodType
	? z.output<T>
	: string;
/** Base Harness Agent for Agent model orchestration. */

export class BaseHarnessAgent<T extends ZodType | null = null> {
	protected readonly agent: ReturnType<typeof createAgent>;
	protected readonly model: AgentModel;
	protected readonly responseFormat: T | undefined;

	constructor({
		model,
		temperature = 0,
		reasoningEffort = "medium",
		systemPrompt,
		responseFormat,
		tools = [],
		...modelKwargs
	}: {
		model?: string;
		temperature?: number;
		reasoningEffort?: "minimal" | "low" | "medium" | "high";
		systemPrompt?: string;
		responseFormat?: T;
		tools?: readonly GenericTool[];
		[key: string]: unknown;
	}) {
		const modelName = model ?? process.env.FAST_LLM;
		if (!modelName) {
			throw new Error(
				"No model configured. Pass `model=...` or set `FAST_LLM`.",
			);
		}

		this.model = ChatOpenAI({
			model: modelName,
			temperature,
			reasoningEffort,
			...modelKwargs,
		});

		this.responseFormat = responseFormat;

		const baseAgentParams = {
			model: this.model,
			tools: [...tools],
		};
		if (this.responseFormat) {
			this.agent =
				systemPrompt !== undefined
					? createAgent({
							...baseAgentParams,
							systemPrompt,
							responseFormat: this.responseFormat,
						})
					: createAgent({
							...baseAgentParams,
							responseFormat: this.responseFormat,
						});
			return;
		}

		this.agent =
			systemPrompt !== undefined
				? createAgent({
						...baseAgentParams,
						systemPrompt,
					})
				: createAgent(baseAgentParams);
	}

	protected processResponse(response: AgentResponse<T>): AgentOutput<T> {
		if (this.responseFormat) {
			if (response.structuredResponse === undefined) {
				throw new Error("Expected structuredResponse but none was returned.");
			}
			return response.structuredResponse as AgentOutput<T>;
		}

		const messageList = response.messages;
		const lastMessage =
			Array.isArray(messageList) && messageList.length > 0
				? messageList.at(-1)
				: null;
		if (!lastMessage || typeof lastMessage !== "object") {
			return "" as AgentOutput<T>;
		}
		const content = (lastMessage as { content?: unknown }).content;
		return (content ?? "") as AgentOutput<T>;
	}
}
/** Web Loader Agent for Agent model orchestration. */

export class WebLoaderAgent<
	T extends ZodType | null = null,
> extends BaseHarnessAgent<T> {
	constructor(args: Record<string, unknown> = {}) {
		super({
			...args,
			tools: [webloaderTool],
		});
	}

	async invoke(userInput: string): Promise<AgentOutput<T>> {
		const response = (await this.agent.invoke({
			messages: [{ role: "user", content: userInput }],
		} as AgentInvokeInput)) as AgentResponse<T>;
		return this.processResponse(response);
	}
}
/** Image Analysis Agent for Agent model orchestration. */

export class ImageAnalysisAgent<
	T extends ZodType | null = null,
> extends BaseHarnessAgent<T> {
	async invoke(
		imagePaths: string | string[],
		description = "",
	): Promise<AgentOutput<T>> {
		const mediaMessage = await MediaMessage.fromPathAsync({
			paths: imagePaths,
			description,
		});
		const response = (await this.agent.invoke({
			messages: [mediaMessage],
		} as AgentInvokeInput)) as AgentResponse<T>;
		return this.processResponse(response);
	}
}
/** High-level fixer for either raw text or a file on disk. */

export class FixerAgent {
	private readonly model?: string;
	private readonly systemPrompt?: string;
	readonly defaultPrompt: string;
	readonly maxIterations: number;
	readonly restoreBestOnFailure: boolean;

	constructor({
		model,
		systemPrompt,
		defaultPrompt = DEFAULT_FIXER_TASK_PROMPT,
		maxIterations = DEFAULT_FIXER_MAX_ITERATIONS,
		restoreBestOnFailure = true,
	}: {
		model?: string;
		systemPrompt?: string;
		defaultPrompt?: string;
		maxIterations?: number;
		restoreBestOnFailure?: boolean;
	} = {}) {
		this.model = model;
		this.systemPrompt = systemPrompt;
		this.defaultPrompt = defaultPrompt;
		this.maxIterations = maxIterations;
		this.restoreBestOnFailure = restoreBestOnFailure;
	}

	private resolveContext(context?: string) {
		return context || this.defaultPrompt;
	}

	async invoke(
		target: string,
		options: { context?: string } = {},
	): Promise<string> {
		try {
			const { stat } = await import("node:fs/promises");
			const pathStat = await stat(target);
			if (pathStat.isFile()) {
				return this.fixFile(target, options);
			}
		} catch {
			// Fall back to treating the target as raw text.
		}
		return this.fixText(target, options);
	}

	async fixFile(
		path: string,
		{ context }: { context?: string } = {},
	): Promise<string> {
		const { readFile } = await import("node:fs/promises");
		await runFixFile({
			path,
			fixerModel: this.model,
			fixerContext: this.resolveContext(context),
			fixerSystemPrompt: this.systemPrompt,
			maxIterations: this.maxIterations,
			restoreBestOnFailure: this.restoreBestOnFailure,
		});
		return readFile(path, "utf-8");
	}

	fixText(text: string, { context }: { context?: string } = {}) {
		return runFixText({
			text,
			fixerModel: this.model,
			fixerContext: this.resolveContext(context),
			fixerSystemPrompt: this.systemPrompt,
			maxIterations: this.maxIterations,
			restoreBestOnFailure: this.restoreBestOnFailure,
		});
	}
}
/** ReAct summarizer wrapper for YouTube transcript workflows. */

export class YouTubeSummarizerReAct {
	private readonly targetLanguage: string | null | undefined;

	constructor(targetLanguage?: string | null) {
		this.targetLanguage = targetLanguage;
	}

	invoke(transcriptOrUrl: string): Promise<Summary> {
		return summarizeVideoReact({
			transcriptOrUrl,
			targetLanguage: this.targetLanguage ?? null,
		});
	}
}
/** Summarizer wrapper for YouTube transcript workflows. */

export class YouTubeSummarizer {
	private readonly targetLanguage: string | null | undefined;

	constructor(targetLanguage?: string | null) {
		this.targetLanguage = targetLanguage;
	}

	invoke(transcriptOrUrl: string): Promise<Summary> {
		return summarizeVideoLite({
			transcriptOrUrl,
			targetLanguage: this.targetLanguage ?? null,
		});
	}
}
/** Gemini summarizer wrapper for YouTube transcript workflows. */

export class YouTubeSummarizerGemini {
	private readonly options: {
		model?: string;
		thinkingLevel?: "minimal" | "low" | "medium" | "high";
		targetLanguage?: string;
		apiKey?: string;
	};

	constructor(
		options: {
			model?: string;
			thinkingLevel?: "minimal" | "low" | "medium" | "high";
			targetLanguage?: string;
			apiKey?: string;
		} = {},
	) {
		this.options = options;
	}

	invoke(videoUrl: string): Promise<Summary | null> {
		const payload: {
			videoUrl: string;
			model?: string;
			thinkingLevel?: "minimal" | "low" | "medium" | "high";
			targetLanguage?: string;
			apiKey?: string;
		} = { videoUrl };

		if (this.options.model) {
			payload.model = this.options.model;
		}
		if (this.options.thinkingLevel) {
			payload.thinkingLevel = this.options.thinkingLevel;
		}
		if (this.options.targetLanguage) {
			payload.targetLanguage = this.options.targetLanguage;
		}
		if (this.options.apiKey) {
			payload.apiKey = this.options.apiKey;
		}

		return summarizeVideoGemini(payload);
	}
}
