/** Client adapter helpers. */

export { parseStream } from "./parsers/chunks.js";
export { getMetadata } from "./parsers/metadata.js";
export { parseBatch, parseInvoke } from "./parsers/responses.js";
export type { StructuredOutput } from "./parsers/types.js";
