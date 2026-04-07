/** Text tagging and filtering helpers for transcript cleanup. */

import { z } from "zod";

export const TagRangeSchema = z.object({
	start_tag: z.string().describe("The starting line tag, e.g., [L10]"),
	end_tag: z.string().describe("The ending line tag, e.g., [L20]"),
});

type TagRange = z.infer<typeof TagRangeSchema>;
/** Tag the content. */

export function tagContent(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line, index) => `[L${index + 1}] ${line}`)
		.join("\n");
}
/** Untag the content. */

export function untagContent(text: string): string {
	return text.replace(/^\[L\d+\]\s*/gm, "");
}
/** Filter the content. */

export function filterContent(taggedText: string, ranges: TagRange[]): string {
	const lines = taggedText.split(/\r?\n/);
	if (ranges.length === 0) {
		return taggedText;
	}

	const tagToIndex = new Map<string, number>();
	for (const [idx, line] of lines.entries()) {
		if (!line.startsWith("[L")) {
			continue;
		}

		const end = line.indexOf("]");
		if (end !== -1) {
			tagToIndex.set(line.slice(0, end + 1), idx);
		}
	}

	const keepLineMask = Array.from({ length: lines.length }, () => true);

	for (const range of ranges) {
		const startIdx = tagToIndex.get(range.start_tag);
		const endIdx = tagToIndex.get(range.end_tag);
		if (startIdx === undefined || endIdx === undefined) {
			continue;
		}

		const [firstIdx, lastIdx] =
			startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
		keepLineMask.fill(false, firstIdx, lastIdx + 1);
	}

	return lines.filter((_, idx) => keepLineMask[idx]).join("\n");
}
