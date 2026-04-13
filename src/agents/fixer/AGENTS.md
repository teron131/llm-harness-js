# Codemap: `llm-harness-js/src/agents/fixer`

## Scope

- Generic single-file fixer workflow that iteratively edits UTF-8 text using hashline references and review-driven loop control.

## What Module Is For

- This module runs a bounded cleanup loop for one existing text file using the active task prompt plus system prompt as the success target.

## High-signal locations

- `src/agents/fixer/fixer.ts -> fixFile/fixText`
- `src/agents/fixer/prompts.ts -> DEFAULT_FIXER_* + build*Prompt`
- `src/agents/fixer/state.ts -> FixerInput/FixerResult/FixerProgress`
- `src/agents/fixer/task-log.ts -> stopReasonForTaskLog/taskLogScore`

## Repository snapshot

- Primary API: `fixFile`, `fixText`, `FixerAgent`
- Edit primitive: hashline edits applied through `SandboxFS`
- Default public task: grammar/spelling/typo cleanup unless the caller supplies context

## Key takeaways per location

- `fixer.ts` owns the iterative edit/review loop and temporary sandbox flow for raw text.
- `prompts.ts` separates the public default task prompt from the lower-level system constraints.
- `task-log.ts` decides whether remaining work is significant enough to continue.

## Project-specific conventions and rationale

- Keep edits local and line-anchored; avoid broad rewrites.
- Preserve parseability for structured files.
- Keep the public API simple while leaving the internal workflow prompt-driven.
