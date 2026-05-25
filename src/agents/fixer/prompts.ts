/** Prompt builders for the generic file fixer workflow. */

export const DEFAULT_FIXER_TASK_PROMPT =
	"Fix grammar, spelling, and obvious typos while preserving meaning and structure.";

export const DEFAULT_FIXER_SYSTEM_PROMPT = `Edit the file directly to satisfy the task.

Hard constraints:
- Treat the file as generic UTF-8 text unless the content itself implies stricter structure.
- Be format-aware: preserve the native structure and syntax of the file you are editing.
- For structured formats such as JSON, YAML, TOML, XML, CSV, Markdown frontmatter, or code/config files, make local edits that keep the file parseable and keep delimiters, indentation, keys, list/object shape, and ordering stable unless the task clearly requires a structural change.
- For structured files containing long embedded text blocks, prefer the smallest local fix that resolves a concrete issue; do not rewrite large text values just to improve formatting, grammar, or stylistic consistency.
- For prose or plain-text formats, preserve surrounding layout and conventions unless the task clearly requires reflow.
- Never "repair" parts of the file that are outside the requested change just because the format suggests a broader cleanup.
- Each pass will provide the current full file text.
- If changes are needed, return ONLY JSON in the shape {"patch":"..."} where patch is an apply-patch edit.
- If no changes are needed, return exactly {"patch":null}.
- Preserve meaning and surrounding structure; avoid broad rewrites.
- Do not add explanations, markdown fences, or commentary when returning the patch JSON.`;

export const CLEAN_TASK_LOG = "DONE:\n- clean\nREMAINING:\n- none";
export const ALLOWED_FIXER_ACTIONS = [
	"ADD",
	"ALIGN",
	"DEDUPE",
	"FILL",
	"FIX",
	"MERGE",
	"NORMALIZE",
	"REMOVE",
	"REORDER",
	"SPLIT",
	"TRIM",
] as const;
export const HIGH_PRIORITY_FIXER_ACTIONS = [
	"FIX",
	"ADD",
	"REMOVE",
	"MERGE",
	"FILL",
	"SPLIT",
	"DEDUPE",
] as const;
export const LOW_PRIORITY_FIXER_ACTIONS = [
	"NORMALIZE",
	"REORDER",
	"ALIGN",
	"TRIM",
] as const;

const FIXER_ACTION_MEANINGS: Record<
	(typeof ALLOWED_FIXER_ACTIONS)[number],
	string
> = {
	FIX: "correct incorrect existing text or values",
	ADD: "insert a small missing local value, delimiter, field, or line when the current file clearly shows where it belongs",
	REMOVE: "delete stray, broken, or duplicate text",
	MERGE: "consolidate repeated or split content into one correct form",
	FILL: "populate an obviously missing local value when the current file provides enough evidence",
	NORMALIZE: "align nearby formatting or consistency without broad rewriting",
	SPLIT: "separate wrongly combined local content into distinct correct parts",
	REORDER:
		"reorder nearby local items only when the current file itself makes the correct order clear",
	DEDUPE: "remove duplicated local content while keeping one correct copy",
	ALIGN:
		"make nearby sibling fields or entries follow the same local pattern when the correct pattern is already present",
	TRIM: "remove clearly extraneous surrounding whitespace or punctuation without changing meaning",
};

function normalizeTargetFile(targetFile: string): string {
	let startIndex = 0;
	while (targetFile[startIndex] === "/") {
		startIndex += 1;
	}
	return targetFile.slice(startIndex);
}

export function buildFixerAgentPrompt({
	targetFile,
	fixerContext = "",
	maxTurns,
}: {
	targetFile: string;
	fixerContext?: string;
	maxTurns: number;
}) {
	const contextBlock = fixerContext ? `\nContext:\n${fixerContext}\n` : "";
	const normalizedTarget = normalizeTargetFile(targetFile);
	const promptLines = [
		`Work on /${normalizedTarget} directly.`,
		"",
		"Fix as many obvious safe issues as you can per pass.",
		"Prefer fewer, higher-yield passes over many tiny passes.",
		"Keep unchanged text stable and return only the JSON apply-patch response.",
		`Stay within ${maxTurns} passes.${contextBlock}`,
	];
	return promptLines.join("\n");
}

export function buildFixerPassPrompt({
	targetFile,
	currentText,
	passNumber,
	maxTurns,
	taskLog = "",
}: {
	targetFile: string;
	currentText: string;
	passNumber: number;
	maxTurns: number;
	taskLog?: string;
}) {
	const taskLogBlock = taskLog ? `\nCurrent task log:\n${taskLog}\n` : "";
	const passesRemaining = maxTurns - passNumber + 1;
	const normalizedTarget = normalizeTargetFile(targetFile);
	const promptLines = [
		`Pass ${passNumber} for /${normalizedTarget}.`,
		"",
		"Keep working until the file satisfies the task. Do not stop just because you fixed one issue if visible remaining work still exists.",
		"Fix all obvious issues you can confidently resolve in this pass, not just the first one you notice.",
		`You have ${passesRemaining} passes remaining including this one, so prefer a broader safe cleanup over a tiny one-issue edit.`,
		"If the task log lists remaining work, use it as a priority guide and try to clear several items before stopping.",
		`Allowed local cleanup actions are: ${ALLOWED_FIXER_ACTIONS.join(", ")}.`,
		"Prefer edits that complete several nearby allowed actions in one pass when the context is exact.",
		"For structured files with long string values, do not rewrite a large embedded text block unless the task log identifies a concrete local corruption inside that block.",
		"Do not spend passes on heading-level normalization, whitespace polish, punctuation polish, or grammar polish unless those issues clearly break structure or signal local corruption.",
		"",
		"Patch rules:",
		"- Return an apply-patch edit in `patch`, not full file contents or an explanation.",
		`- The patch must use this exact envelope: \`*** Begin Patch\`, \`*** Update File: /${normalizedTarget}\`, one or more \`@@\` chunks, then \`*** End Patch\`.`,
		"- The patch value must be a JSON string, so encode patch newlines as `\\n`.",
		"- Keep unchanged text byte-for-byte stable wherever practical.",
		"- Preserve syntax that belongs on each physical line, including trailing commas, braces, brackets, quotes, and indentation.",
		"- Prefer the smallest local patch that keeps the surrounding structure valid.",
		'- If no changes are needed in this pass, return exactly {"patch":null}.',
		'- Return only valid JSON in the shape {"patch":"..."} or {"patch":null}.',
		taskLogBlock,
		"",
		"Current file text:",
		currentText,
	];
	return promptLines.join("\n");
}

export function buildFixerProgressPrompt({
	targetFile,
	currentText,
}: {
	targetFile: string;
	currentText: string;
}) {
	const normalizedTarget = normalizeTargetFile(targetFile);
	const actionMeanings = ALLOWED_FIXER_ACTIONS.map(
		(action) => `  ${action} = ${FIXER_ACTION_MEANINGS[action]}`,
	).join("\n");
	const promptLines = [
		`Update a tiny progress checklist for /${normalizedTarget}.`,
		"",
		"Use the current file text only.",
		"Judge the current file against the active system prompt for this fixer run.",
		"Return ONLY a compact checklist in this exact shape:",
		"",
		"DONE:",
		"- ...",
		"REMAINING:",
		"- ACTION: ...",
		"",
		"Rules:",
		"- Keep the checklist short and concrete.",
		"- Tick off work clearly completed in the current file.",
		"- Keep only visible remaining work needed to satisfy the task in the REMAINING section.",
		"- Prefer issue clusters over line-by-line details.",
		"- Keep at most 3 REMAINING bullets.",
		"- Keep only actionable, local cleanup items that can be fixed from the current file alone.",
		`- Every REMAINING bullet must start with one of these actions: ${ALLOWED_FIXER_ACTIONS.join(", ")}.`,
		"- Action meanings:",
		actionMeanings,
		`- Treat ${HIGH_PRIORITY_FIXER_ACTIONS.join(", ")} as higher-priority remaining work.`,
		`- Treat ${LOW_PRIORITY_FIXER_ACTIONS.join(", ")} as lower-priority cleanup.`,
		"- For structured files with long embedded text values, only call out issues inside those values when they are clearly local corruption, duplication, broken delimiters, or visibly broken numbering/label sequences with an obvious local fix.",
		"- Do not include source-validation, segmentation, anchor, or coverage tasks.",
		"- Do not include confirm/verify/check/review-only tasks.",
		"- Do not include optional polish or stylistic suggestions as remaining work.",
		"- Do not include grammar polish, markdown heading-level normalization, whitespace normalization, or punctuation cleanup unless it changes parseability or fixes clear local corruption.",
		"- If only lower-priority cleanup remains and the file otherwise satisfies the task, treat the file as clean.",
		"- Do not repeat uncertain or non-actionable items.",
		"- If an unresolved item cannot be safely fixed from the current file alone, drop it instead of repeating it.",
		"- If the file now looks clean, return exactly:",
		"DONE:",
		"- clean",
		"REMAINING:",
		"- none",
		"",
		"Current file text:",
		currentText,
	];
	return promptLines.join("\n");
}

export function buildReviewSystemPrompt(systemPrompt: string) {
	return [
		systemPrompt,
		"",
		"For this call, do not rewrite the file. Return only the compact checklist requested by the user prompt.",
	].join("\n");
}
