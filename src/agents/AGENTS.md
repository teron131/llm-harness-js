# Codemap: `llm-harness-js/src/agents`

## Scope

- Agent orchestration layer that wraps chat models, tools, and YouTube summarization workflows.

## What Module Is For

- This module orchestrates chat models and tools into reusable TypeScript agent classes and wrappers.

## High-signal locations

- `src/agents/agents.ts -> BaseHarnessAgent/Web*Agent/ImageAnalysisAgent/YouTubeSummarizer*`
- `src/agents/exa.ts -> ExaAnswerAgent/ExaLoadAgent`
- `src/agents/index.ts -> tool registry + exported surface`
- `src/agents/youtube/index.ts -> top-level YouTube entrypoints`

## Repository snapshot

- High-signal files listed below form the stable architecture anchors for this module.
- Keep imports and exports aligned with these anchors when extending behavior.

## Symbol Inventory

- Primary symbols are enumerated in the high-signal locations and syntax relationship sections.
- Preserve existing exported names unless changing a public contract intentionally.

## Key takeaways per location

- `BaseHarnessAgent` is the core path for model setup and response handling.
- `WebLoaderAgent` adds the web loader tool while `BaseHarnessAgent` remains the generic chat path.
- `ImageAnalysisAgent` routes media content through `MediaMessage`.
- YouTube summarizer classes delegate to `agents/youtube/*` modules.
- Exa agents live in `agents/exa.ts` so content loading and Exa Answer behavior stay separate from the generic chat wrappers.
- `agents/index.ts` assembles the default tool registry from `tools/*`.

## Project-specific conventions and rationale

- Keep agent constructors lightweight and pass provider details through `clients/openai.ts`.
- Preserve class names aligned with Python equivalents (`YouTubeSummarizer`, `YouTubeSummarizerReAct`, `YouTubeSummarizerGemini`), with aliases acceptable.
- Keep orchestration logic in `agents`, not in `utils` or `tools`.

## Syntax Relationships

- `agents.ts -> import ChatOpenAI from clients/openai.ts`
- `agents.ts -> import MediaMessage from clients/multimodal.ts`
- `agents.ts -> import summarizeVideo* from agents/youtube/*`
- `exa.ts -> import Exa from exa-js`
- `exa.ts -> import BaseHarnessAgent from agents.ts for optional structured parsing`
- `index.ts -> getTools() returns webloaderTool + youtubeloaderTool from tools/*`

## General approach (not rigid checklist)

- Add new agent variants by extending the base behavior first.
- Keep invoke contracts explicit (`input -> Promise<output>`).
- Prefer delegating multi-step workflows to specialized submodules (`agents/youtube`).

## Validation commands

- `cd llm-harness-js && pnpm run build`
- `/Users/teron/Projects/Agents-Config/.factory/hooks/formatter.sh`
