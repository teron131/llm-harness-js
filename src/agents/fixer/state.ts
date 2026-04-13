/** State and public types for the generic file fixer workflow. */

export const DEFAULT_FIXER_MAX_ITERATIONS = 3;

export type FixerReviewKind = "" | "no_change" | "empty_edit" | "patched";

export type FixerInput = {
	rootDir: string;
	targetFile: string;
	fixerModel: string;
	fixerContext: string;
	fixerSystemPrompt: string;
	maxIterations: number;
	restoreBestOnFailure: boolean;
};

export type FixerResult = {
	fixerTokensIn: number;
	fixerTokensOut: number;
	fixerCost: number;
	fixerNotes: string;
	iteration: number;
	fixerCompleted: boolean;
	fixerLastText: string;
};

export type FixerProgress = FixerResult & {
	bestText: string | null;
	bestNotes: string;
	bestScore: [number, number] | null;
	repeatedRemainingReviews: number;
	lastRemainingBlock: string;
};

export function createInitialProgress(): FixerProgress {
	return {
		fixerTokensIn: 0,
		fixerTokensOut: 0,
		fixerCost: 0,
		fixerNotes: "",
		iteration: 0,
		fixerCompleted: false,
		fixerLastText: "",
		bestText: null,
		bestNotes: "",
		bestScore: null,
		repeatedRemainingReviews: 0,
		lastRemainingBlock: "",
	};
}
