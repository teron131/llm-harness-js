# llm-harness-js

TypeScript companion repo for `llm-harness`, shaped by accumulated work across multiple projects rather than a generic harness.

## Structure

```text
src/
├── index.ts   public exports
├── agents/    workflow orchestration
│   ├── fixer/
│   └── youtube/
├── clients/   runtime adapters
│   └── parsers/
├── stats/     LLM and image stats
│   ├── llm/
│   └── image/
├── tools/     integration boundaries
│   ├── fs/
│   ├── web/
│   └── youtube/
└── utils/     shared helpers
```

## Install

```bash
pnpm install
```

## Build

```bash
pnpm run build
```

## Typecheck

```bash
pnpm run typecheck
```

## LLM Stats Table

Print the current LLM stats payload as a terminal table:

```bash
pnpm run stats:table
```

Useful flags:

```bash
pnpm run stats:table -- --top 15
pnpm run stats:table -- --id google/gemini-3.1-pro-preview
pnpm run stats:table -- --cached
```

## Runtime configuration

Set the active runtime pair before invoking chat or embedding clients:

```bash
export LLM_API_KEY="..."
export LLM_BASE_URL="https://your-openai-compatible-endpoint/v1"
```

`LLM_API_KEY` and `LLM_BASE_URL` are the only runtime env vars the code reads for OpenAI-compatible clients.

The runtime provider wiring uses the repo-local `ChatOpenAI` and `OpenAIEmbeddings` wrappers in `src/clients/openai.ts`.

The Python package now lives in the sibling repo `../llm-harness`.
