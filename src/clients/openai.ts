/** OpenAI-compatible client helpers for chat and embedding models. */

import {
	ChatOpenAI as NativeChatOpenAI,
	OpenAIEmbeddings as NativeOpenAIEmbeddings,
} from "@langchain/openai";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

type ReasoningEffort = "minimal" | "low" | "medium" | "high";

type ClientOptions = {
	apiKey?: string;
	configuration?: Record<string, unknown>;
} & Record<string, unknown>;

type ChatModelOptions = ClientOptions & {
	model: string;
	temperature?: number;
	reasoningEffort?: ReasoningEffort;
};

function resolveApiKey(options: ClientOptions): string | undefined {
	return options.apiKey ?? process.env.LLM_API_KEY;
}

function resolveBaseURL(options: ClientOptions): string | undefined {
	const baseURL = options.configuration?.baseURL;
	if (typeof baseURL === "string") {
		return baseURL;
	}

	return process.env.LLM_BASE_URL;
}

function stripReservedModelKwargs(kwargs: Record<string, unknown>): void {
	delete kwargs.model;
	delete kwargs.temperature;
	delete kwargs.reasoningEffort;
	delete kwargs.reasoning_effort;
}

function shouldUseResponsesApi({
	model,
	baseURL,
}: {
	model: string;
	baseURL?: string;
}): boolean {
	return Boolean(
		baseURL?.toLowerCase().includes("opencode") &&
			model.toLowerCase().includes("gpt"),
	);
}

function resolveUseResponsesApi(
	options: ClientOptions & { model: string },
	baseURL?: string,
): boolean | undefined {
	if (typeof options.useResponsesApi === "boolean") {
		return options.useResponsesApi;
	}

	if (shouldUseResponsesApi({ model: options.model, baseURL })) {
		return true;
	}
}

function buildClientOptions<T extends ClientOptions>(options: T): T {
	const nextOptions = { ...options };
	const apiKey = resolveApiKey(nextOptions);
	const baseURL = resolveBaseURL(nextOptions);

	if (apiKey) {
		nextOptions.apiKey = apiKey;
	}

	if (baseURL) {
		nextOptions.configuration = {
			...(nextOptions.configuration ?? {}),
			baseURL,
		};
	}

	return nextOptions;
}

function buildChatModelOptions({
	model,
	temperature = 0.7,
	reasoningEffort,
	...kwargs
}: ChatModelOptions): ClientOptions & { model: string } {
	stripReservedModelKwargs(kwargs);
	const options: ClientOptions & { model: string } = buildClientOptions({
		model,
		...kwargs,
	});
	const baseURL = resolveBaseURL(options);
	const useResponsesApi = resolveUseResponsesApi(options, baseURL);

	if (useResponsesApi !== undefined) {
		options.useResponsesApi = useResponsesApi;
	}

	if (!useResponsesApi) {
		options.temperature = temperature;
	}

	if (reasoningEffort) {
		options.reasoning = {
			...((options.reasoning as Record<string, unknown> | undefined) ?? {}),
			effort: reasoningEffort,
		};
	}

	return options;
}

/** Initialize an OpenAI-compatible chat model. */
export function ChatOpenAI({
	model,
	temperature,
	reasoningEffort,
	...kwargs
}: {
	model: string;
	temperature?: number;
	reasoningEffort?: ReasoningEffort;
	[key: string]: unknown;
}): NativeChatOpenAI {
	return new NativeChatOpenAI(
		buildChatModelOptions({
			model,
			temperature,
			reasoningEffort,
			...(kwargs as Record<string, unknown>),
		}),
	);
}

/** Initialize an OpenAI-compatible embedding model. */
export function OpenAIEmbeddings({
	model = DEFAULT_EMBEDDING_MODEL,
	...kwargs
}: {
	model?: string;
	[key: string]: unknown;
} = {}): NativeOpenAIEmbeddings {
	return new NativeOpenAIEmbeddings(
		buildClientOptions({
			model,
			...(kwargs as Record<string, unknown>),
		}),
	);
}
