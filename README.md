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

Set the active runtime pair before invoking chat or embedding clients:

```bash
export LLM_API_KEY="..."
export LLM_BASE_URL="https://your-openai-compatible-endpoint/v1"
```

`LLM_API_KEY` and `LLM_BASE_URL` are the only runtime env vars the code reads for OpenAI-compatible clients.

The runtime provider wiring uses the repo-local `ChatOpenAI` and `OpenAIEmbeddings` wrappers in `src/clients/openai.ts`.

The Python package now lives in the sibling repo `../llm-harness`.
