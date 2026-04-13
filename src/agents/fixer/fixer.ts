/** Public entrypoint for the generic file fixer workflow. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "../../clients/openai.js";
import { getMetadata } from "../../clients/parsers/metadata.js";
import { SandboxFS } from "../../tools/fs/fs-tools.js";
import {
	editHashline,
	type HashlineEdit,
	HashlineEditResponseSchema,
	HashlineReferenceError,
} from "../../tools/fs/hashline.js";
import {
	buildFixerAgentPrompt,
	buildFixerPassPrompt,
	buildFixerProgressPrompt,
	buildHashlineRepairPrompt,
	buildHashlineRepairSystemPrompt,
	buildReviewSystemPrompt,
	CLEAN_TASK_LOG,
	DEFAULT_FIXER_SYSTEM_PROMPT,
} from "./prompts.js";
import {
	createInitialProgress,
	DEFAULT_FIXER_MAX_ITERATIONS,
	type FixerInput,
	type FixerProgress,
	type FixerResult,
} from "./state.js";
import {
	normalizedRemainingBlock,
	stopReasonForTaskLog,
	taskLogScore,
} from "./task-log.js";

const EMPTY_EDIT_SENTINEL = "__FIXER_EMPTY_EDIT__";
const MAX_REPEAT_REMAINING_REVIEWS = 2;

type WriteApplyResult = {
	afterText: string | null;
	writeError?: string;
	tokensIn?: number;
	tokensOut?: number;
	cost?: number;
};

function resolveModelName(model?: string) {
	const resolvedModel = model ?? process.env.FAST_LLM;
	if (!resolvedModel) {
		throw new Error(
			"No model configured. Pass `fixerModel=...` or set `FAST_LLM`.",
		);
	}
	return resolvedModel;
}

function resolveTarget({ path, rootDir }: { path: string; rootDir?: string }) {
	const targetPath = resolve(path);
	const normalizedRootPath = rootDir ? resolve(rootDir) : dirname(targetPath);
	const relativeTarget = rootDir
		? relative(normalizedRootPath, targetPath)
		: basename(targetPath);
	return {
		rootPath: normalizedRootPath,
		targetFile: relativeTarget.replaceAll("\\", "/"),
	};
}

function appendWriteNote(existingNotes: string, note: string) {
	const writeNote = `WRITE NOTE:\n- ${note}`;
	return existingNotes ? `${existingNotes}\n\n${writeNote}` : writeNote;
}

function addUsage(
	progress: FixerProgress,
	[tokensIn, tokensOut, cost]: [number, number, number],
) {
	progress.fixerTokensIn += tokensIn;
	progress.fixerTokensOut += tokensOut;
	progress.fixerCost += cost;
}

function buildResult(progress: FixerProgress): FixerResult {
	return {
		fixerTokensIn: progress.fixerTokensIn,
		fixerTokensOut: progress.fixerTokensOut,
		fixerCost: progress.fixerCost,
		fixerNotes: progress.fixerNotes,
		iteration: progress.iteration,
		fixerCompleted: progress.fixerCompleted,
		fixerLastText: progress.fixerLastText,
	};
}

function stripCodeFences(text: string) {
	const stripped = text.trim();
	if (!stripped.startsWith("```") || !stripped.endsWith("```")) {
		return stripped;
	}

	const lines = stripped.split("\n");
	if (lines[0]?.startsWith("```")) {
		lines.shift();
	}
	if (lines.at(-1)?.trim() === "```") {
		lines.pop();
	}
	return lines.join("\n").trim();
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

function parseHashlineEditResponse(content: unknown) {
	const rawText =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((item) =>
							typeof item === "string"
								? item
								: typeof item === "object" && item !== null && "text" in item
									? String(item.text ?? "")
									: "",
						)
						.join("")
				: String(content ?? "");
	const cleaned = stripCodeFences(rawText);
	const parsed = JSON.parse(cleaned || '{"edits":[]}');
	return {
		rawText: cleaned,
		response: HashlineEditResponseSchema.parse(parsed),
	};
}

function summarizeWriteError(error: Error) {
	const firstLine = error.message.split("\n")[0]?.trim();
	return firstLine || error.name;
}

async function writeEdits({
	fs,
	targetPath,
	currentText,
	edits,
	usage = [0, 0, 0],
}: {
	fs: SandboxFS;
	targetPath: string;
	currentText: string;
	edits: HashlineEdit[];
	usage?: [number, number, number];
}): Promise<WriteApplyResult> {
	const updatedText = editHashline(currentText, edits);

	try {
		JSON.parse(currentText);
	} catch {
		// Non-JSON text can continue without validation.
		if (updatedText === currentText) {
			return {
				afterText: currentText,
				writeError: EMPTY_EDIT_SENTINEL,
				tokensIn: usage[0],
				tokensOut: usage[1],
				cost: usage[2],
			};
		}
		await fs.writeText(targetPath, updatedText);
		return {
			afterText: updatedText,
			tokensIn: usage[0],
			tokensOut: usage[1],
			cost: usage[2],
		};
	}

	try {
		JSON.parse(updatedText);
	} catch (error) {
		throw new Error(`write broke JSON validity: ${(error as Error).message}`);
	}

	if (updatedText === currentText) {
		return {
			afterText: currentText,
			writeError: EMPTY_EDIT_SENTINEL,
			tokensIn: usage[0],
			tokensOut: usage[1],
			cost: usage[2],
		};
	}

	await fs.writeText(targetPath, updatedText);
	return {
		afterText: updatedText,
		tokensIn: usage[0],
		tokensOut: usage[1],
		cost: usage[2],
	};
}

function updateBestSnapshot(progress: FixerProgress, currentText: string) {
	const candidateScore = taskLogScore(progress.fixerNotes);
	if (progress.bestText === null) {
		progress.bestText = currentText;
		progress.bestNotes = progress.fixerNotes;
		progress.bestScore = candidateScore;
		return;
	}
	if (!candidateScore) {
		return;
	}
	if (
		progress.bestScore === null ||
		candidateScore[0] < progress.bestScore[0] ||
		(candidateScore[0] === progress.bestScore[0] &&
			candidateScore[1] <= progress.bestScore[1])
	) {
		progress.bestText = currentText;
		progress.bestNotes = progress.fixerNotes;
		progress.bestScore = candidateScore;
	}
}

async function runReviewSnapshot({
	input,
	progress,
	currentText,
}: {
	input: FixerInput;
	progress: FixerProgress;
	currentText: string;
}) {
	const response = await ChatOpenAI({
		model: input.fixerModel,
		temperature: 0,
		reasoningEffort: "low",
	}).invoke([
		new SystemMessage(
			buildReviewSystemPrompt(
				input.fixerSystemPrompt || DEFAULT_FIXER_SYSTEM_PROMPT,
			),
		),
		new HumanMessage(
			buildFixerProgressPrompt({
				targetFile: input.targetFile,
				currentText,
			}),
		),
	]);

	addUsage(progress, getMetadata(asMetadataRecord(response)));
	progress.fixerNotes =
		stripCodeFences(
			String((response as { content?: unknown }).content ?? ""),
		) || CLEAN_TASK_LOG;
	updateBestSnapshot(progress, currentText);
}

async function runFixPass({
	input,
	progress,
	fs,
	targetPath,
	passNumber,
}: {
	input: FixerInput;
	progress: FixerProgress;
	fs: SandboxFS;
	targetPath: string;
	passNumber: number;
}) {
	const response = await ChatOpenAI({
		model: input.fixerModel,
		temperature: 0,
		reasoningEffort: "low",
	}).invoke([
		new SystemMessage(input.fixerSystemPrompt || DEFAULT_FIXER_SYSTEM_PROMPT),
		new HumanMessage(
			`${buildFixerAgentPrompt({
				targetFile: input.targetFile,
				fixerContext: input.fixerContext,
				maxTurns: input.maxIterations,
			})}\n\n${buildFixerPassPrompt({
				targetFile: input.targetFile,
				currentText: await fs.readHashline(targetPath),
				passNumber,
				maxTurns: input.maxIterations,
				taskLog: progress.fixerNotes,
			})}`,
		),
	]);

	addUsage(progress, getMetadata(asMetadataRecord(response)));
	return parseHashlineEditResponse((response as { content?: unknown }).content);
}

async function runRepairPass({
	input,
	progress,
	fs,
	targetPath,
	errorText,
	attemptedEdits,
}: {
	input: FixerInput;
	progress: FixerProgress;
	fs: SandboxFS;
	targetPath: string;
	errorText: string;
	attemptedEdits: string;
}) {
	const response = await ChatOpenAI({
		model: input.fixerModel,
		temperature: 0,
		reasoningEffort: "low",
	}).invoke([
		new SystemMessage(
			buildHashlineRepairSystemPrompt(
				input.fixerSystemPrompt || DEFAULT_FIXER_SYSTEM_PROMPT,
			),
		),
		new HumanMessage(
			buildHashlineRepairPrompt({
				errorText,
				taskLog: progress.fixerNotes || CLEAN_TASK_LOG,
				currentText: await fs.readHashline(targetPath),
				attemptedEdits,
			}),
		),
	]);

	const usage = getMetadata(asMetadataRecord(response));
	const { response: parsed } = parseHashlineEditResponse(
		(response as { content?: unknown }).content,
	);
	return {
		parsed,
		usage,
	};
}

async function restoreBestSnapshot({
	fs,
	targetPath,
	progress,
}: {
	fs: SandboxFS;
	targetPath: string;
	progress: FixerProgress;
}) {
	if (progress.bestText === null) {
		return;
	}
	const currentDiskText = await fs.readText(targetPath);
	if (currentDiskText !== progress.bestText) {
		await fs.writeText(targetPath, progress.bestText);
	}
	progress.fixerNotes = appendWriteNote(
		progress.bestNotes,
		"restored best snapshot after max_turns",
	);
}

async function reviewAndMaybeStop({
	input,
	progress,
	currentText,
	stopKind,
}: {
	input: FixerInput;
	progress: FixerProgress;
	currentText: string;
	stopKind: "no_change" | "empty_edit";
}) {
	await runReviewSnapshot({ input, progress, currentText });
	const currentRemainingBlock = normalizedRemainingBlock(progress.fixerNotes);
	if (
		currentRemainingBlock &&
		currentRemainingBlock === progress.lastRemainingBlock
	) {
		progress.repeatedRemainingReviews += 1;
	} else {
		progress.repeatedRemainingReviews = 0;
		progress.lastRemainingBlock = currentRemainingBlock;
	}

	const stopReason = stopReasonForTaskLog(progress.fixerNotes);
	if (stopReason) {
		progress.fixerCompleted = true;
		progress.fixerLastText = stopKind === "no_change" ? "no_change" : "done";
		return true;
	}
	if (progress.repeatedRemainingReviews >= MAX_REPEAT_REMAINING_REVIEWS) {
		progress.fixerLastText = "stalled";
		return true;
	}
	return false;
}

export async function fixFile({
	path,
	rootDir,
	fixerModel,
	fixerContext = "",
	fixerSystemPrompt = DEFAULT_FIXER_SYSTEM_PROMPT,
	maxIterations = DEFAULT_FIXER_MAX_ITERATIONS,
	restoreBestOnFailure = true,
}: {
	path: string;
	rootDir?: string;
	fixerModel?: string;
	fixerContext?: string;
	fixerSystemPrompt?: string;
	maxIterations?: number;
	restoreBestOnFailure?: boolean;
}): Promise<FixerResult> {
	const { rootPath, targetFile } = resolveTarget({ path, rootDir });
	const input: FixerInput = {
		rootDir: rootPath,
		targetFile,
		fixerModel: resolveModelName(fixerModel),
		fixerContext,
		fixerSystemPrompt,
		maxIterations,
		restoreBestOnFailure,
	};
	const fs = new SandboxFS(rootPath);
	const virtualTargetPath = `/${targetFile.replace(/^\/+/, "")}`;
	const progress = createInitialProgress();

	let currentText = await fs.readText(virtualTargetPath);
	await runReviewSnapshot({ input, progress, currentText });
	progress.lastRemainingBlock = normalizedRemainingBlock(progress.fixerNotes);
	if (stopReasonForTaskLog(progress.fixerNotes)) {
		progress.fixerCompleted = true;
		progress.fixerLastText = "done";
		return buildResult(progress);
	}

	for (let passNumber = 1; passNumber <= input.maxIterations; passNumber += 1) {
		progress.iteration = passNumber;
		const { response: editResponse, rawText } = await runFixPass({
			input,
			progress,
			fs,
			targetPath: virtualTargetPath,
			passNumber,
		});

		if (editResponse.edits.length === 0) {
			if (
				await reviewAndMaybeStop({
					input,
					progress,
					currentText,
					stopKind: "no_change",
				})
			) {
				return buildResult(progress);
			}
			continue;
		}

		let writeResult: WriteApplyResult;
		try {
			writeResult = await writeEdits({
				fs,
				targetPath: virtualTargetPath,
				currentText,
				edits: editResponse.edits,
			});
		} catch (error) {
			if (
				!(error instanceof HashlineReferenceError) &&
				!(error instanceof Error)
			) {
				throw error;
			}
			const repaired = await runRepairPass({
				input,
				progress,
				fs,
				targetPath: virtualTargetPath,
				errorText: error.message,
				attemptedEdits: rawText,
			});
			addUsage(progress, repaired.usage);
			if (repaired.parsed.edits.length === 0) {
				writeResult = { afterText: null, writeError: error.message };
			} else {
				try {
					writeResult = await writeEdits({
						fs,
						targetPath: virtualTargetPath,
						currentText,
						edits: repaired.parsed.edits,
						usage: repaired.usage,
					});
				} catch (repairError) {
					writeResult = {
						afterText: null,
						writeError:
							repairError instanceof Error
								? repairError.message
								: String(repairError),
					};
				}
			}
		}

		addUsage(progress, [
			writeResult.tokensIn ?? 0,
			writeResult.tokensOut ?? 0,
			writeResult.cost ?? 0,
		]);

		if (
			writeResult.writeError === EMPTY_EDIT_SENTINEL &&
			writeResult.afterText === currentText
		) {
			if (
				await reviewAndMaybeStop({
					input,
					progress,
					currentText,
					stopKind: "empty_edit",
				})
			) {
				return buildResult(progress);
			}
			continue;
		}

		if (writeResult.afterText === null) {
			if (writeResult.writeError) {
				progress.fixerNotes = appendWriteNote(
					progress.fixerNotes,
					summarizeWriteError(new Error(writeResult.writeError)),
				);
			}
			continue;
		}

		currentText = writeResult.afterText;
		await runReviewSnapshot({ input, progress, currentText });
		progress.lastRemainingBlock = normalizedRemainingBlock(progress.fixerNotes);
		progress.repeatedRemainingReviews = 0;
		if (stopReasonForTaskLog(progress.fixerNotes)) {
			progress.fixerCompleted = true;
			progress.fixerLastText = "done";
			return buildResult(progress);
		}
	}

	if (input.restoreBestOnFailure) {
		await restoreBestSnapshot({
			fs,
			targetPath: virtualTargetPath,
			progress,
		});
	}
	progress.fixerLastText = "max_turns";
	return buildResult(progress);
}

export async function fixText({
	text,
	fixerModel,
	fixerContext = "",
	fixerSystemPrompt = DEFAULT_FIXER_SYSTEM_PROMPT,
	maxIterations = DEFAULT_FIXER_MAX_ITERATIONS,
	restoreBestOnFailure = true,
	sandboxFileName = "input.txt",
}: {
	text: string;
	fixerModel?: string;
	fixerContext?: string;
	fixerSystemPrompt?: string;
	maxIterations?: number;
	restoreBestOnFailure?: boolean;
	sandboxFileName?: string;
}) {
	const tempDir = await mkdtemp(resolve(tmpdir(), "llm-harness-fixer-"));
	const fs = new SandboxFS(tempDir);
	const sandboxPath = `/${sandboxFileName.replace(/^\/+/, "")}`;

	try {
		await fs.writeText(sandboxPath, text);
		await fixFile({
			path: fs.resolve(sandboxPath),
			rootDir: tempDir,
			fixerModel,
			fixerContext,
			fixerSystemPrompt,
			maxIterations,
			restoreBestOnFailure,
		});
		return await fs.readText(sandboxPath);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}
