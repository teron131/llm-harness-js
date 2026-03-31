/** LLM model tokenization helpers. */

/** Tokenization helpers for matcher scoring, especially around model scales and variant suffixes. */
import { normalizeModelToken } from "../shared";

const MODEL_NAME_TAG_TOKENS = new Set([
  "free",
  "extended",
  "exacto",
  "instruct",
  "vl",
  "thinking",
  "reasoning",
  "online",
  "nitro",
]);
/** Split LLM model tokenization into normalized tokens. */

export function splitBaseModelId(modelId: string): string {
  const modelIdParts = modelId.split("/");
  return modelIdParts.at(-1) ?? modelId;
}
/** Split LLM model tokenization into normalized tokens. */

export function splitBaseModelTokens(modelId: string): string[] {
  return splitTokens(splitBaseModelId(modelId));
}
/** Return whether bscale token is true. */

function isBScaleToken(token: string): boolean {
  return /^\d+b$/.test(token) || /^a\d+b$/.test(token);
}
/** Split LLM model tokenization into normalized tokens. */

function splitMixedAlphaNumericToken(token: string): string[] {
  if (isBScaleToken(token)) {
    return [token];
  }
  return token.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/g).filter(Boolean);
}
/** Split the tokens. */

export function splitTokens(value: string): string[] {
  return normalizeModelToken(value)
    .split("-")
    .flatMap((token) => splitMixedAlphaNumericToken(token))
    .filter((token) => token && !MODEL_NAME_TAG_TOKENS.has(token));
}
/** Helper for first parsed number. */

export function firstParsedNumber(
  tokens: string[],
  parser: (token: string | undefined) => number | null,
): number | null {
  for (const token of tokens) {
    const parsedValue = parser(token);
    if (parsedValue != null) {
      return parsedValue;
    }
  }
  return null;
}
/** Return whether the current value is valid for LLM model tokenization. */

export function isNumericToken(token: string | undefined): boolean {
  return Boolean(token && /^\d+$/.test(token));
}
/** Parse the numeric or bscale token. */

function parseNumericOrBScaleToken(token: string | undefined): number | null {
  if (!token) {
    return null;
  }
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  const billionMatch = /^(\d+)b$/.exec(token);
  if (billionMatch) {
    return Number(billionMatch[1]);
  }
  const aBillionMatch = /^a(\d+)b$/.exec(token);
  if (aBillionMatch) {
    return Number(aBillionMatch[1]);
  }
  return null;
}
/** Parse the bscale token. */

export function parseBScaleToken(token: string | undefined): number | null {
  if (!token) {
    return null;
  }
  const billionMatch = /^(\d+)b$/.exec(token);
  return billionMatch ? Number(billionMatch[1]) : null;
}
/** Parse the active btoken. */

export function parseActiveBToken(token: string | undefined): number | null {
  if (!token) {
    return null;
  }
  const activeMatch = /^a(\d+)b$/.exec(token);
  return activeMatch ? Number(activeMatch[1]) : null;
}
/** Helper for parsed numeric tokens. */

export function parsedNumericTokens(tokens: string[]): number[] {
  return tokens
    .map((token) => parseNumericOrBScaleToken(token))
    .filter((value): value is number => value != null);
}
/** Helper for common prefix length. */

export function commonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }
  return index;
}
