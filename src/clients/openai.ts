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

/** Apply LLM_* environment defaults to an OpenAI-compatible client config. */
function applyOpenAIEnvironment<T extends ClientOptions>(options: T): T {
    const nextOptions = { ...options };
    const baseURL = process.env.LLM_BASE_URL;

    if (process.env.LLM_API_KEY && nextOptions.apiKey === undefined) {
        nextOptions.apiKey = process.env.LLM_API_KEY;
    }

    const configuration = nextOptions.configuration ?? {};
    if (baseURL && configuration.baseURL === undefined) {
        nextOptions.configuration = {
            ...configuration,
            baseURL,
        };
    }

    return nextOptions;
}

/** Merge reasoning effort into the OpenAI-compatible chat config. */
function applyReasoningEffort<T extends ClientOptions>(
    options: T,
    reasoningEffort?: ReasoningEffort,
): T {
    if (!reasoningEffort) {
        return options;
    }

    return {
        ...options,
        reasoning: {
            ...((options.reasoning as Record<string, unknown> | undefined) ??
                {}),
            effort: reasoningEffort,
        },
    };
}

/** Initialize an OpenAI-compatible chat model. */
export function ChatOpenAI({
    model,
    temperature = 0.7,
    reasoningEffort,
    ...kwargs
}: {
    model: string;
    temperature?: number;
    reasoningEffort?: ReasoningEffort;
    [key: string]: unknown;
}): NativeChatOpenAI {
    const options = applyReasoningEffort(
        applyOpenAIEnvironment({
            model,
            temperature,
            ...(kwargs as Record<string, unknown>),
        }),
        reasoningEffort,
    );

    return new NativeChatOpenAI(options);
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
        applyOpenAIEnvironment({
            model,
            ...(kwargs as Record<string, unknown>),
        }),
    );
}
