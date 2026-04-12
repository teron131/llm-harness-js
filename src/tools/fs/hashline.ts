/**
 * Minimal hashline edit tool.
 *
 * Hashline refs let models address file edits by line number plus a short
 * content-derived hash so stale references can be detected reliably.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

const HASHLINE_OPERATION_VALUES = [
	"replace_range",
	"insert_before",
	"insert_after",
] as const;

const HashlineOperationSchema = z.enum(HASHLINE_OPERATION_VALUES);

export const HashlineEditSchema = z
	.object({
		operation: HashlineOperationSchema.describe("Edit operation."),
		start_ref: z
			.string()
			.describe("Target hashline ref, for example '12#ab3f9d'."),
		end_ref: z
			.string()
			.optional()
			.describe("Inclusive end ref for range replacement."),
		lines: z
			.array(z.string())
			.default([])
			.describe(
				"Replacement or inserted file lines without hashline prefixes.",
			),
	})
	.superRefine((value, ctx) => {
		if (value.operation === "replace_range" && !value.end_ref) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "replace_range requires end_ref",
				path: ["end_ref"],
			});
		}
	});

export type HashlineEdit = z.infer<typeof HashlineEditSchema>;

class HashlineReferenceError extends Error {
	/** Raised when a hashline ref cannot be resolved against the current file text. */
	constructor(message: string) {
		super(message);
		this.name = "HashlineReferenceError";
	}
}

const VISIBLE_HASH_LENGTH = 6;
const HASHLINE_REF_RE = new RegExp(
	`^(?<line>\\d+)#(?<hash>[0-9a-f]{${VISIBLE_HASH_LENGTH}})$`,
);
const WHITESPACE_RE = /\s+/g;
const HASHLINE_LINE_RE = new RegExp(
	`^(?<ref>\\d+#[0-9a-f]{${VISIBLE_HASH_LENGTH}}):(?<content>.*)$`,
);
const NEARBY_HASHLINE_WINDOW = 3;
const TEXT_ENCODER = new TextEncoder();

/**
 * Return the visible hash fragment for a line at a specific line number.
 *
 * The hash ignores whitespace differences and includes the line number so a
 * ref identifies both the content and its position in the file.
 */
function computeLineHash(lineNumber: number, line: string): string {
	const normalizedLine = line.replace(/\r$/u, "").replace(WHITESPACE_RE, "");
	const payload = TEXT_ENCODER.encode(`${lineNumber}\0${normalizedLine}`);
	return createHash("sha256")
		.update(payload)
		.digest("hex")
		.slice(0, VISIBLE_HASH_LENGTH);
}

/** Render one source line in the `LINE#HASH` ref format. */
function formatHashlineRef(lineNumber: number, line: string): string {
	return `${lineNumber}#${computeLineHash(lineNumber, line)}`;
}

/** Convert plain text into hashline-formatted lines for model-facing prompts. */
export function formatHashlineText(text: string): string {
	return text
		.split(/\r?\n/)
		.filter((line, index, lines) => index < lines.length - 1 || line !== "")
		.map((line, index) => `${formatHashlineRef(index + 1, line)}:${line}`)
		.join("\n");
}

/**
 * Apply a validated batch of hashline edits to plain file text.
 *
 * The function resolves all target refs against the original text first,
 * rejects overlapping replacement ranges, then applies the edits from bottom
 * to top so earlier replacements do not shift later splice indices.
 */
export function editHashline(text: string, edits: HashlineEdit[]): string {
	if (edits.length === 0) {
		return text;
	}

	const hasTrailingNewline = text.endsWith("\n");
	const lines = text.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	const replacements: Array<[number, number, string[]]> = [];
	const replaceRanges: Array<[number, number]> = [];

	for (const edit of edits) {
		const [start, end] = editBounds(edit, lines);
		const validRefs = new Set<string>([edit.start_ref]);
		if (edit.end_ref) {
			validRefs.add(edit.end_ref);
		}
		replacements.push([
			start,
			end,
			edit.lines.map((line) => stripAccidentalRefPrefix(line, validRefs)),
		]);
		if (edit.operation === "replace_range") {
			replaceRanges.push([start, end]);
		}
	}

	ensureNonOverlappingRanges(replaceRanges);

	for (const [start, end, newLines] of [...replacements]
		.sort((left, right) => sortRanges([left[0], left[1]], [right[0], right[1]]))
		.reverse()) {
		lines.splice(start, end - start, ...newLines);
	}

	if (lines.length === 0) {
		return "";
	}
	return `${lines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

/** Parse a `LINE#HASH` ref into its 1-based line number and hash fragment. */
function parseRef(ref: string): [number, string] {
	const match = HASHLINE_REF_RE.exec(ref.trim());
	if (!match?.groups) {
		throw new HashlineReferenceError(
			`Invalid hashline ref: ${JSON.stringify(ref)}`,
		);
	}
	return [Number(match.groups.line ?? "0"), match.groups.hash ?? ""];
}

/** Build a helpful error message for an invalid or stale hashline ref. */
function buildMismatchMessage(
	ref: string,
	lines: string[],
	lineNumber: number,
): string {
	const preview = (index: number) =>
		`${formatHashlineRef(index, lines[index - 1] ?? "")}:${lines[index - 1] ?? ""}`;

	const previews: string[] = [`Stale hashline ref: ${ref}`];
	if (lineNumber >= 1 && lineNumber <= lines.length) {
		previews.push(`Current line at that position: ${preview(lineNumber)}`);
	} else {
		previews.push(`Current file has ${lines.length} lines.`);
	}

	const start = Math.max(1, lineNumber - 1);
	const end = Math.min(lines.length, lineNumber + 1);
	if (start <= end) {
		previews.push("Nearby current refs:");
		for (let index = start; index <= end; index += 1) {
			previews.push(`- ${preview(index)}`);
		}
	}
	return previews.join("\n");
}

/** Search nearby lines for a unique hash match when the original ref no longer matches exactly. */
function findNearbyHashMatch(
	lines: string[],
	expectedHash: string,
	lineNumber: number,
): number | null {
	const start = Math.max(1, lineNumber - NEARBY_HASHLINE_WINDOW);
	const end = Math.min(lines.length, lineNumber + NEARBY_HASHLINE_WINDOW);
	const matches: number[] = [];
	for (let index = start; index <= end; index += 1) {
		if (computeLineHash(index, lines[index - 1] ?? "") === expectedHash) {
			matches.push(index);
		}
	}
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Resolve a hashline ref to its current 1-based line number or raise. */
function validateRef(ref: string, lines: string[]): number {
	const [lineNumber, expectedHash] = parseRef(ref);
	if (lineNumber < 1 || lineNumber > lines.length) {
		throw new HashlineReferenceError(
			buildMismatchMessage(ref, lines, lineNumber),
		);
	}

	const actualHash = computeLineHash(lineNumber, lines[lineNumber - 1] ?? "");
	if (actualHash !== expectedHash) {
		const nearbyMatch = findNearbyHashMatch(lines, expectedHash, lineNumber);
		if (nearbyMatch !== null) {
			return nearbyMatch;
		}
		throw new HashlineReferenceError(
			buildMismatchMessage(ref, lines, lineNumber),
		);
	}
	return lineNumber;
}

/** Translate a hashline edit into the splice bounds used for list replacement. */
function editBounds(edit: HashlineEdit, lines: string[]): [number, number] {
	const startLine = validateRef(edit.start_ref, lines);
	if (edit.operation === "insert_before") {
		const index = startLine - 1;
		return [index, index];
	}
	if (edit.operation === "insert_after") {
		return [startLine, startLine];
	}

	const endLine = validateRef(edit.end_ref ?? "", lines);
	if (endLine < startLine) {
		throw new Error(
			`replace_range end_ref must not be before start_ref: ${edit.start_ref} -> ${edit.end_ref}`,
		);
	}
	return [startLine - 1, endLine];
}

/** Reject overlapping replace-range edits before applying them. */
function ensureNonOverlappingRanges(ranges: Array<[number, number]>): void {
	const occupied = [...ranges]
		.filter(([start, end]) => end > start)
		.sort(sortRanges);

	let previousEnd = -1;
	for (const [start, end] of occupied) {
		if (start < previousEnd) {
			throw new Error(
				"Hashline edits contain overlapping replace_range targets.",
			);
		}
		previousEnd = end;
	}
}

/** Remove a leading `LINE#HASH:` prefix when it matches one of the edit refs. */
function stripAccidentalRefPrefix(
	line: string,
	validRefs: Set<string>,
): string {
	const match = HASHLINE_LINE_RE.exec(line);
	if (!match?.groups) {
		return line;
	}
	const ref = match.groups.ref;
	const content = match.groups.content;
	if (!ref || content === undefined) {
		return line;
	}
	return validRefs.has(ref) ? content : line;
}

/** Sort ranges by start index, then by end index. */
function sortRanges(left: [number, number], right: [number, number]): number {
	if (left[0] !== right[0]) {
		return left[0] - right[0];
	}
	return left[1] - right[1];
}
