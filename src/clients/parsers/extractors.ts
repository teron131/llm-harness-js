/** Extract the reasoning from content blocks. */
/** Response extraction helpers. */

export function extractReasoningFromContentBlocks(
	contentBlocks: Record<string, unknown>[],
): string | null {
	const firstBlock = contentBlocks[0];
	if (!firstBlock) {
		return null;
	}

	const reasoning = firstBlock.reasoning;
	if (typeof reasoning === "string") {
		return reasoning;
	}

	const extras = firstBlock.extras;
	if (!extras || typeof extras !== "object") {
		return null;
	}

	const nestedContent = (extras as Record<string, unknown>).content;
	if (!Array.isArray(nestedContent) || nestedContent.length === 0) {
		return null;
	}

	const last = nestedContent.at(-1);
	if (!last || typeof last !== "object") {
		return null;
	}

	const text = (last as Record<string, unknown>).text;
	return typeof text === "string" ? text : null;
}
/** Get the content blocks. */

export function getContentBlocks(
	value: Record<string, unknown>,
): Record<string, unknown>[] {
	const blocks = value.content_blocks;
	return Array.isArray(blocks) ? (blocks as Record<string, unknown>[]) : [];
}
/** Extract provider-specific reasoning details from a streamed chunk. */

function extractReasoningDetails(
	chunk: Record<string, unknown>,
): string {
	const details = chunk.reasoning_details;
	if (!Array.isArray(details)) {
		return "";
	}

	const detailParts: string[] = [];
	for (const detail of details) {
		if (!detail || typeof detail !== "object") {
			continue;
		}

		const typedDetail = detail as Record<string, unknown>;
		const detailType = typedDetail.type;
		if (
			detailType === "reasoning.text" &&
			typeof typedDetail.text === "string"
		) {
			detailParts.push(typedDetail.text);
			continue;
		}

		if (
			detailType === "reasoning.summary" &&
			typeof typedDetail.summary === "string"
		) {
			detailParts.push(typedDetail.summary);
		}
	}

	if (detailParts.length === 0) {
		return "";
	}

	// Some OpenAI-compatible providers return cumulative reasoning deltas.
	return detailParts.at(-1) ?? "";
}
/** Extract the additional kwargs reasoning. */

function extractAdditionalKwargsReasoning(
	chunk: Record<string, unknown>,
): string | null {
	const additionalKwargs = chunk.additional_kwargs;
	if (!additionalKwargs || typeof additionalKwargs !== "object") {
		return null;
	}

	const reasoning = (additionalKwargs as Record<string, unknown>).reasoning;
	if (!reasoning || typeof reasoning !== "object") {
		return null;
	}

	const summary = (reasoning as Record<string, unknown>).summary;
	if (!Array.isArray(summary) || summary.length === 0) {
		return null;
	}

	const lastEntry = summary.at(-1);
	if (!lastEntry || typeof lastEntry !== "object") {
		return null;
	}

	const text = (lastEntry as Record<string, unknown>).text;
	return typeof text === "string" ? text : null;
}
/** Extract the reasoning delta from chunk. */

export function extractReasoningDeltaFromChunk(
	chunk: Record<string, unknown>,
): string | null {
	const detailReasoning = extractReasoningDetails(chunk);
	if (detailReasoning) {
		return detailReasoning;
	}

	if (typeof chunk.reasoning === "string") {
		return chunk.reasoning;
	}

	const additionalKwargsReasoning = extractAdditionalKwargsReasoning(chunk);
	if (additionalKwargsReasoning) {
		return additionalKwargsReasoning;
	}

	const blockReasoning = extractReasoningFromContentBlocks(
		getContentBlocks(chunk),
	);
	if (blockReasoning) {
		return blockReasoning;
	}

	return null;
}
/** Extract the answer from response. */

export function extractAnswerFromResponse(
	response: Record<string, unknown>,
): string {
	const blocks = getContentBlocks(response);
	if (blocks.length === 0) {
		return "";
	}
	const last = blocks.at(-1) as Record<string, unknown>;
	return typeof last.text === "string" ? last.text : "";
}
/** Extract the answer delta from chunk. */

export function extractAnswerDeltaFromChunk(
	chunk: Record<string, unknown>,
): string | null {
	const blocks = getContentBlocks(chunk);
	if (blocks.length > 0) {
		const last = blocks.at(-1);
		if (last && typeof last === "object") {
			const text = (last as Record<string, unknown>).text;
			if (typeof text === "string" && text.length > 0) {
				return text;
			}
		}
	}

	if (typeof chunk.text === "string" && chunk.text.length > 0) {
		return chunk.text;
	}

	return null;
}
/** Convert the input into a plain record for Response extraction. */

export function asRecordArray(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(
		(item): item is Record<string, unknown> =>
			Boolean(item) && typeof item === "object",
	);
}
