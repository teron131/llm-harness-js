/** Exa-backed agents for structured search answers and live webpage loading. */

import Exa from "exa-js";
import type { createAgent } from "langchain";
import type { z, ZodType } from "zod";
import { z as zod } from "zod";

import { BaseHarnessAgent } from "./agents.js";

type AgentInstance = ReturnType<typeof createAgent>;
type AgentInvokeInput = Parameters<AgentInstance["invoke"]>[0];
type AgentResponse<T extends ZodType | null> = {
	messages: unknown[];
	structuredResponse?: T extends ZodType ? z.output<T> : never;
};
type AgentOutput<T extends ZodType | null> = T extends ZodType
	? z.output<T>
	: string;

type ExaAnswerClient = {
	answer(
		query: string,
		options: {
			systemPrompt: string;
			text?: boolean;
			outputSchema: unknown;
		},
	): Promise<{ answer: unknown }>;
};

type ExaContentResult = {
	url?: string;
	title?: string;
	text?: string;
	publishedDate?: string;
};

type ExaContentsClient = {
	getContents(
		urls: string | string[],
		options?: {
			text?: { maxCharacters?: number } | true;
			maxAgeHours?: number;
			livecrawlTimeout?: number;
			filterEmptyResults?: boolean;
		},
	): Promise<{
		results?: ExaContentResult[];
		costDollars?: unknown;
	}>;
};

type ExaClient = ExaAnswerClient & ExaContentsClient;
type ExaConstructor = new (apiKey?: string) => ExaClient;

export type ExaLoadPage = {
	url: string;
	title: string | null;
	text: string;
	publishedDate: string | null;
};

export type ExaLoadOptions = {
	maxCharacters?: number;
	maxAgeHours?: number;
	livecrawlTimeout?: number;
	filterEmptyResults?: boolean;
};

type ExaLoadAgentArgs<T extends ZodType | null> = {
	model?: string;
	temperature?: number;
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	systemPrompt?: string;
	responseFormat?: T;
	outputSchema?: T;
	exaApiKey?: string;
	contentOptions?: ExaLoadOptions;
	[key: string]: unknown;
};

type ExaLoadParserArgs<T extends ZodType | null> = Omit<
	ExaLoadAgentArgs<T>,
	"contentOptions" | "exaApiKey" | "outputSchema"
> & {
	responseFormat?: T;
};

const DEFAULT_EXA_WEBLOAD_SYSTEM_PROMPT = [
	"You answer using only the provided webpage contents fetched through Exa Contents.",
	"Do not search the web, use memory, infer updated facts, or merge in uncited outside information.",
	"If the requested value is missing from the provided content, return null or say it is unavailable.",
	"Preserve source order and table row order when extracting structured data.",
].join(" ");

function toExaJsonSchema(schema: ZodType): unknown {
	const jsonSchema = zod.toJSONSchema(schema) as Record<string, unknown>;
	delete jsonSchema.$schema;
	return jsonSchema;
}

function createExaClient(apiKey?: string): ExaClient {
	const ExaClientConstructor = Exa as unknown as ExaConstructor;
	return new ExaClientConstructor(apiKey ?? process.env.EXA_API_KEY);
}

class SingleTurnHarnessAgent<
	T extends ZodType | null = null,
> extends BaseHarnessAgent<T> {
	async invoke(userInput: string): Promise<AgentOutput<T>> {
		const response = (await this.agent.invoke({
			messages: [{ role: "user", content: userInput }],
		} as AgentInvokeInput)) as AgentResponse<T>;
		return this.processResponse(response);
	}
}

/** Exa Answer agent for structured web search answers. */
export class ExaAnswerAgent<T extends ZodType> {
	private readonly exa: ExaAnswerClient;
	private readonly systemPrompt: string;
	private readonly outputSchema: T;

	constructor(systemPrompt: string, outputSchema: T) {
		this.systemPrompt = systemPrompt;
		this.outputSchema = outputSchema;
		this.exa = createExaClient();
	}

	async invoke(query: string): Promise<z.output<T>> {
		const result = await this.exa.answer(query, {
			systemPrompt: this.systemPrompt,
			outputSchema: toExaJsonSchema(this.outputSchema),
		});

		return this.outputSchema.parse(result.answer);
	}
}

/** Exa Contents loader agent for bot-blocked pages and structured parsing. */
export class ExaLoadAgent<T extends ZodType | null = null> {
	private readonly exa: ExaContentsClient;
	private readonly contentOptions: Required<ExaLoadOptions>;
	private readonly parserArgs: ExaLoadParserArgs<T>;
	private parserAgent: SingleTurnHarnessAgent<T> | null = null;

	constructor({
		outputSchema,
		responseFormat,
		exaApiKey,
		contentOptions = {},
		systemPrompt,
		...agentArgs
	}: ExaLoadAgentArgs<T> = {}) {
		this.exa = createExaClient(exaApiKey);
		const parserModel =
			typeof agentArgs.model === "string"
				? agentArgs.model
				: process.env.QUALITY_LLM;
		this.parserArgs = {
			...agentArgs,
			...(parserModel ? { model: parserModel } : {}),
			systemPrompt: systemPrompt ?? DEFAULT_EXA_WEBLOAD_SYSTEM_PROMPT,
			responseFormat: outputSchema ?? responseFormat,
		};
		this.contentOptions = {
			maxCharacters: contentOptions.maxCharacters ?? 20_000,
			maxAgeHours: contentOptions.maxAgeHours ?? 0,
			livecrawlTimeout: contentOptions.livecrawlTimeout ?? 0,
			filterEmptyResults: contentOptions.filterEmptyResults ?? false,
		};
	}

	private getParserAgent(): SingleTurnHarnessAgent<T> {
		this.parserAgent ??= new SingleTurnHarnessAgent<T>(this.parserArgs);
		return this.parserAgent;
	}

	async load(urls: string | string[]): Promise<{
		pages: ExaLoadPage[];
		costDollars: unknown;
	}> {
		const requestedUrls = Array.isArray(urls) ? urls : [urls];
		const response = await this.exa.getContents(requestedUrls, {
			text: { maxCharacters: this.contentOptions.maxCharacters },
			maxAgeHours: this.contentOptions.maxAgeHours,
			...(this.contentOptions.livecrawlTimeout > 0
				? { livecrawlTimeout: this.contentOptions.livecrawlTimeout }
				: {}),
			filterEmptyResults: this.contentOptions.filterEmptyResults,
		});
		const results = response.results ?? [];
		const pages = results.map((result, index) => ({
			url: result.url ?? requestedUrls[index] ?? "",
			title: result.title?.trim() || null,
			text: result.text ?? "",
			publishedDate: result.publishedDate ?? null,
		}));
		return {
			pages,
			costDollars: response.costDollars ?? null,
		};
	}

	async invoke(
		urls: string | string[],
		instruction = "Extract the requested information from the provided webpage contents.",
	): Promise<AgentOutput<T>> {
		const { pages } = await this.load(urls);
		const sourceBlocks = pages.map((page, index) =>
			[
				`SOURCE ${index + 1}`,
				`URL: ${page.url}`,
				`TITLE: ${page.title ?? ""}`,
				`PUBLISHED_DATE: ${page.publishedDate ?? ""}`,
				"CONTENT:",
				page.text,
			].join("\n"),
		);
		return this.getParserAgent().invoke(
			[
				instruction,
				"Use only the source contents below.",
				"",
				sourceBlocks.join("\n\n---\n\n"),
			].join("\n"),
		);
	}
}
