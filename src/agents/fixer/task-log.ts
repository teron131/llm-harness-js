/** Structured task-log helpers for fixer review decisions. */

import {
	ALLOWED_FIXER_ACTIONS,
	CLEAN_TASK_LOG,
	HIGH_PRIORITY_FIXER_ACTIONS,
	LOW_PRIORITY_FIXER_ACTIONS,
} from "./prompts.js";

const ALLOWED_FIXER_ACTION_PREFIXES = ALLOWED_FIXER_ACTIONS.map(
	(action) => `${action}:`,
);

function taskLogSections(taskLog: string): [string[], string[]] | null {
	const doneLines: string[] = [];
	const remainingLines: string[] = [];
	let section: "done" | "remaining" | null = null;
	let foundSection = false;

	for (const rawLine of taskLog.split("\n")) {
		const line = rawLine.trim();
		if (line === "DONE:") {
			section = "done";
			foundSection = true;
			continue;
		}
		if (line === "REMAINING:") {
			section = "remaining";
			foundSection = true;
			continue;
		}
		if (!line.startsWith("- ")) {
			continue;
		}
		if (section === "done") {
			doneLines.push(line);
			continue;
		}
		if (section === "remaining") {
			remainingLines.push(line);
		}
	}

	return foundSection ? [doneLines, remainingLines] : null;
}

export function normalizedRemainingBlock(taskLog: string) {
	const sections = taskLogSections(taskLog);
	if (!sections) {
		return "";
	}
	return sections[1].join("\n");
}

function remainingActionNames(taskLog: string) {
	const sections = taskLogSections(taskLog);
	if (!sections) {
		return [];
	}

	return sections[1]
		.map((line) => line.slice(2).trim())
		.filter((line) =>
			ALLOWED_FIXER_ACTION_PREFIXES.some((prefix) => line.startsWith(prefix)),
		)
		.map((line) => line.split(":", 1)[0] ?? "");
}

export function stopReasonForTaskLog(taskLog: string) {
	if (taskLog.trim() === CLEAN_TASK_LOG) {
		return "clean";
	}
	const remainingActions = remainingActionNames(taskLog);
	if (remainingActions.length === 0) {
		return "clean_enough";
	}
	if (
		remainingActions.every((action) =>
			LOW_PRIORITY_FIXER_ACTIONS.includes(
				action as (typeof LOW_PRIORITY_FIXER_ACTIONS)[number],
			),
		)
	) {
		return "soft_remaining_only";
	}
	return null;
}

export function taskLogScore(taskLog: string): [number, number] | null {
	const sections = taskLogSections(taskLog);
	if (!sections) {
		return null;
	}

	const [doneLines] = sections;
	const remainingActions = remainingActionNames(taskLog);
	const strongRemaining = remainingActions.filter((action) =>
		HIGH_PRIORITY_FIXER_ACTIONS.includes(
			action as (typeof HIGH_PRIORITY_FIXER_ACTIONS)[number],
		),
	).length;
	const softRemaining = remainingActions.filter((action) =>
		LOW_PRIORITY_FIXER_ACTIONS.includes(
			action as (typeof LOW_PRIORITY_FIXER_ACTIONS)[number],
		),
	).length;
	return [strongRemaining, softRemaining - doneLines.length];
}
