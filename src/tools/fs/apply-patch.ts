/** Minimal single-file patch tool. */

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

interface UpdateFileChunk {
  change_context: string | null;
  old_lines: string[];
  new_lines: string[];
  is_end_of_file: boolean;
  removed_lines: number;
  inserted_lines: number;
}

interface UpdateFileHunk {
  path: string;
  move_path: string | null;
  chunks: UpdateFileChunk[];
}

interface PatchStats {
  hunk_count: number;
  lines_removed: number;
  lines_inserted: number;
  lines_touched: number;
}

type LineNormalizer = (value: string) => string;
type Replacement = [
  startIndex: number,
  replacedLineCount: number,
  newLines: string[],
];
type ReplacementCandidate = [oldLines: string[], newLines: string[]];

const PUNCTUATION_TRANSLATION: Record<string, string> = {
  "\u00a0": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200a": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  "\u202f": " ",
  "\u205f": " ",
  "\u2212": "-",
  "\u3000": " ",
};

export function parseSingleFilePatchWithStats(args: {
  patch_text: string;
  target_path?: string;
}): [UpdateFileHunk, PatchStats] {
  const hunks = parsePatchText(args.patch_text);
  if (hunks.length === 0) {
    throw new Error("No files were modified.");
  }
  if (hunks.length !== 1) {
    throw new Error("Patch must update exactly one file.");
  }

  const hunk = validateSingleFileHunk(hunks[0]!, args.target_path);
  return [hunk, collectPatchStats(hunks)];
}

export function applyPatchHunkToText(args: {
  original_text: string;
  file_path: string;
  hunk: UpdateFileHunk;
}): string {
  return applyUpdateChunks({
    original_text: args.original_text,
    file_path: args.file_path,
    chunks: args.hunk.chunks,
  });
}

function validateSingleFileHunk(
  hunk: UpdateFileHunk,
  targetPath?: string,
): UpdateFileHunk {
  if (targetPath !== undefined) {
    const expectedPath = normalizePatchPath(targetPath);
    const actualPath = normalizePatchPath(hunk.path);
    if (actualPath !== expectedPath) {
      throw new Error(
        `Patch targets ${JSON.stringify(hunk.path)}, expected ${JSON.stringify(targetPath)}.`,
      );
    }
  }
  if (hunk.move_path !== null) {
    throw new Error("Move operations are not supported.");
  }
  return hunk;
}

function normalizePatchPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function parsePatchText(patchText: string): UpdateFileHunk[] {
  const stripped = patchText.trim();
  if (!stripped) {
    throw new Error("Patch input is empty.");
  }

  const lines = stripped.split(/\r?\n/);
  if (lines[0]?.trim() !== BEGIN_PATCH_MARKER) {
    throw new Error("The first line of the patch must be '*** Begin Patch'.");
  }
  if (lines.at(-1)?.trim() !== END_PATCH_MARKER) {
    throw new Error("The last line of the patch must be '*** End Patch'.");
  }

  const hunks: UpdateFileHunk[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (!line.startsWith(UPDATE_FILE_MARKER)) {
      throw new Error(
        `Unsupported patch hunk header: ${JSON.stringify(lines[index])}`,
      );
    }

    const path = line.slice(UPDATE_FILE_MARKER.length).trim();
    index += 1;

    let movePath: string | null = null;
    const maybeMoveLine = lines[index]?.trim();
    if (maybeMoveLine?.startsWith(MOVE_TO_MARKER)) {
      movePath = maybeMoveLine.slice(MOVE_TO_MARKER.length).trim();
      index += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    let allowMissingContext = true;
    while (index < lines.length - 1) {
      const current = lines[index] ?? "";
      const strippedCurrent = current.trim();
      if (!strippedCurrent) {
        index += 1;
        continue;
      }
      if (strippedCurrent.startsWith("*** ")) {
        break;
      }

      const [chunk, consumed] = parseUpdateChunk(
        lines.slice(index, lines.length - 1),
        allowMissingContext,
      );
      chunks.push(chunk);
      allowMissingContext = false;
      index += consumed;
    }

    if (chunks.length === 0) {
      throw new Error(`Update file hunk for ${JSON.stringify(path)} is empty.`);
    }
    hunks.push({ path, move_path: movePath, chunks });
  }

  return hunks;
}

function parseUpdateChunk(
  lines: string[],
  allowMissingContext: boolean,
): [UpdateFileChunk, number] {
  if (lines.length === 0) {
    throw new Error("Update hunk does not contain any lines.");
  }

  let index = 0;
  let changeContext: string | null = null;
  const first = lines[index] ?? "";
  if (first === EMPTY_CHANGE_CONTEXT_MARKER) {
    index += 1;
  } else if (first.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = first.slice(CHANGE_CONTEXT_MARKER.length);
    index += 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Expected update hunk to start with @@ context marker, got ${JSON.stringify(first)}.`,
    );
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let isEndOfFile = false;
  let changeCount = 0;
  let removedLines = 0;
  let insertedLines = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const stripped = line.trim();
    if (stripped === EOF_MARKER) {
      isEndOfFile = true;
      index += 1;
      break;
    }
    if (isChunkBoundary(line)) {
      break;
    }
    if (!line) {
      throw new Error("Patch change lines must start with ' ', '+', or '-'.");
    }

    const prefix = line[0];
    const payload = line.slice(1);
    if (prefix === " ") {
      oldLines.push(payload);
      newLines.push(payload);
    } else if (prefix === "-") {
      oldLines.push(payload);
      removedLines += 1;
    } else if (prefix === "+") {
      newLines.push(payload);
      insertedLines += 1;
    } else {
      throw new Error(`Invalid patch line prefix ${JSON.stringify(prefix)}.`);
    }
    changeCount += 1;
    index += 1;
  }

  if (changeCount === 0) {
    throw new Error("Update hunk has no change lines.");
  }

  return [
    {
      change_context: changeContext,
      old_lines: oldLines,
      new_lines: newLines,
      is_end_of_file: isEndOfFile,
      removed_lines: removedLines,
      inserted_lines: insertedLines,
    },
    index,
  ];
}

function collectPatchStats(hunks: UpdateFileHunk[]): PatchStats {
  let hunkCount = 0;
  let linesRemoved = 0;
  let linesInserted = 0;

  for (const hunk of hunks) {
    hunkCount += hunk.chunks.length;
    for (const chunk of hunk.chunks) {
      linesRemoved += chunk.removed_lines;
      linesInserted += chunk.inserted_lines;
    }
  }

  return {
    hunk_count: hunkCount,
    lines_removed: linesRemoved,
    lines_inserted: linesInserted,
    lines_touched: linesRemoved + linesInserted,
  };
}

function isChunkBoundary(line: string): boolean {
  const stripped = line.trim();
  return (
    stripped.startsWith("*** ") ||
    line === EMPTY_CHANGE_CONTEXT_MARKER ||
    line.startsWith(CHANGE_CONTEXT_MARKER)
  );
}

function applyUpdateChunks(args: {
  original_text: string;
  file_path: string;
  chunks: UpdateFileChunk[];
}): string {
  const hasTrailingNewline = args.original_text.endsWith("\n");
  const originalLines = args.original_text.split("\n");
  if (originalLines.at(-1) === "") {
    originalLines.pop();
  }

  const replacements = computeReplacements(
    originalLines,
    args.file_path,
    args.chunks,
  );
  const newLines = applyReplacements(originalLines, replacements);
  if (newLines.length === 0) {
    return "";
  }
  return `${newLines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Replacement[] {
  const replacements: Replacement[] = [];
  let searchStart = 0;

  for (const chunk of chunks) {
    searchStart = advanceToChunkContext(
      originalLines,
      filePath,
      chunk.change_context,
      searchStart,
    );
    const replacement = findChunkReplacement(
      originalLines,
      filePath,
      chunk,
      searchStart,
    );
    replacements.push(replacement);
    searchStart = replacement[0] + replacement[1];
  }

  return replacements.sort((left, right) => left[0] - right[0]);
}

function advanceToChunkContext(
  lines: string[],
  filePath: string,
  changeContext: string | null,
  start: number,
): number {
  if (changeContext === null) {
    return start;
  }

  const contextIndex = seekSequence({
    lines,
    pattern: [changeContext],
    start,
    eof: false,
  });
  if (contextIndex === null) {
    throw new Error(
      `Failed to find context ${JSON.stringify(changeContext)} in ${filePath}.`,
    );
  }
  return contextIndex + 1;
}

function findChunkReplacement(
  lines: string[],
  filePath: string,
  chunk: UpdateFileChunk,
  start: number,
): Replacement {
  if (chunk.old_lines.length === 0) {
    return [lines.length, 0, chunk.new_lines];
  }

  const candidatePatterns = getChunkMatchPatterns(chunk);
  for (const [oldLines, newLines] of candidatePatterns) {
    const matchIndex = seekSequence({
      lines,
      pattern: oldLines,
      start,
      eof: chunk.is_end_of_file,
    });
    if (matchIndex !== null) {
      return [matchIndex, oldLines.length, newLines];
    }
  }

  throw new Error(
    `Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`,
  );
}

function getChunkMatchPatterns(chunk: UpdateFileChunk): ReplacementCandidate[] {
  const patterns: ReplacementCandidate[] = [[chunk.old_lines, chunk.new_lines]];
  if (chunk.old_lines.at(-1) !== "") {
    return patterns;
  }

  const trimmedOldLines = chunk.old_lines.slice(0, -1);
  const trimmedNewLines =
    chunk.new_lines.at(-1) === ""
      ? chunk.new_lines.slice(0, -1)
      : chunk.new_lines;
  patterns.push([trimmedOldLines, trimmedNewLines]);
  return patterns;
}

function applyReplacements(
  lines: string[],
  replacements: Replacement[],
): string[] {
  const result = [...lines];
  for (const [startIndex, replacedLineCount, newLines] of [
    ...replacements,
  ].reverse()) {
    result.splice(startIndex, replacedLineCount, ...newLines);
  }
  return result;
}

function seekSequence(args: {
  lines: string[];
  pattern: string[];
  start: number;
  eof: boolean;
}): number | null {
  const { lines, pattern, start, eof } = args;
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const maxStart = lines.length - pattern.length;
  const searchStart = eof && lines.length >= pattern.length ? maxStart : start;
  if (searchStart > maxStart) {
    return null;
  }

  for (const normalize of LINE_NORMALIZERS) {
    for (let index = searchStart; index <= maxStart; index += 1) {
      if (linesMatch(lines, pattern, index, normalize)) {
        return index;
      }
    }
  }

  return null;
}

function linesMatch(
  lines: string[],
  pattern: string[],
  start: number,
  normalize: LineNormalizer,
): boolean {
  return pattern.every(
    (expected, offset) =>
      normalize(lines[start + offset] ?? "") === normalize(expected),
  );
}

function normalizePunctuation(value: string): string {
  return Array.from(
    value,
    (char) => PUNCTUATION_TRANSLATION[char] ?? char,
  ).join("");
}

function normalizeWhitespace(value: string): string {
  return value.trim().split(/\s+/).join(" ");
}

const LINE_NORMALIZERS: LineNormalizer[] = [
  (value) => value,
  (value) => value.replace(/\s+$/u, ""),
  (value) => value.trim(),
  (value) => normalizeWhitespace(value),
  (value) => normalizePunctuation(value.trim()),
  (value) => normalizeWhitespace(normalizePunctuation(value)),
];
