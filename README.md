# llm-harness-js

Standalone TypeScript port of `llm_harness`, split into its own repo.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Typecheck

```bash
npm run typecheck
```

## Runtime configuration

Set your OpenAI-compatible credentials before invoking chat or embedding clients:

```bash
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://your-openai-compatible-endpoint/v1"
```

The runtime provider wiring uses the repo-local `ChatOpenAI` and `OpenAIEmbeddings` wrappers in `src/clients/openai.ts`.

The Python package now lives in the sibling repo `../llm-harness`.
