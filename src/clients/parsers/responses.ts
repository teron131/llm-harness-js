/** Response parsing helpers. */

import {
    extractAnswerFromResponse,
    extractReasoningFromContentBlocks,
    getContentBlocks,
} from "./extractors.js";
/** Parse the invoke. */

export function parseInvoke(
    response: Record<string, unknown>,
    includeReasoning = false,
): string | [string | null, string] {
    const answer = extractAnswerFromResponse(response);
    if (!includeReasoning) {
        return answer;
    }

    const reasoning = extractReasoningFromContentBlocks(
        getContentBlocks(response),
    );
    return [reasoning, answer];
}
/** Parse the batch. */

export function parseBatch(
    responses: Record<string, unknown>[],
    includeReasoning = false,
): Array<string | [string | null, string]> {
    return responses.map((response) => parseInvoke(response, includeReasoning));
}
