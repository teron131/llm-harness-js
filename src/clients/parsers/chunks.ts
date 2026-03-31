/** Stream chunk parsing helpers. */

import { getHarnessEventStream } from "./events.js";

type StreamParseChunk = string | [string | null, string | null];

function splitStreamChunk(
  chunk: StreamParseChunk,
): readonly [reasoningText: string | null, answerText: string | null] {
  return Array.isArray(chunk) ? chunk : [null, chunk];
}

async function* getStreamGenerator(
  stream: AsyncIterable<Record<string, unknown>>,
  includeReasoning = false,
): AsyncGenerator<StreamParseChunk> {
  let hasYieldedReasoning = false;

  for await (const event of getHarnessEventStream(stream, {
    includeReasoning,
    dedupeReasoning: true,
    emitReasoningBoundaries: false,
  })) {
    if (event.type === "text-delta") {
      yield includeReasoning ? [null, event.delta] : event.delta;
      continue;
    }
    if (
      event.type !== "reasoning-delta" ||
      !includeReasoning ||
      hasYieldedReasoning
    ) {
      continue;
    }

    hasYieldedReasoning = true;
    yield [event.delta, null];
  }
}

export async function parseStream(
  stream: AsyncIterable<Record<string, unknown>>,
  includeReasoning = false,
): Promise<string | [string | null, string]> {
  let reasoning: string | null = null;
  const answerParts: string[] = [];

  for await (const chunk of getStreamGenerator(stream, includeReasoning)) {
    const [reasoningText, answerText] = splitStreamChunk(chunk);

    if (reasoningText !== null) {
      reasoning = reasoningText;
      console.log(`Reasoning: ${reasoning}`);
    }
    if (answerText !== null) {
      answerParts.push(answerText);
      process.stdout.write(answerText);
    }
  }

  const answer = answerParts.join("");
  return includeReasoning ? [reasoning, answer] : answer;
}
