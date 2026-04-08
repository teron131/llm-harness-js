/**
 * Minimal single-file patch tool.
 *
 * The parser accepts the `*** Begin Patch` / `*** Update File` format and
 * resolves each chunk against existing text with a small amount of whitespace
 * and punctuation tolerance.
 */

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

/**
 * One local block of line changes inside a file patch.
 *
 * Each `@@` section in an update-file block becomes one patch chunk.
 */
interface PatchChunk {
    change_context: string | null;
    old_lines: string[];
    new_lines: string[];
    is_end_of_file: boolean;
    removed_lines: number;
    inserted_lines: number;
}

/** All patch chunks that apply to one file update section. */
interface FilePatch {
    path: string;
    move_path: string | null;
    chunks: PatchChunk[];
}

/** Summarize how many chunks and line changes a parsed patch contains. */
interface PatchStats {
    chunk_count: number;
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

/** Parse one-file patch text and return both the patch and its summary stats. */
export function parseSingleFilePatchWithStats(args: {
    patch_text: string;
    target_path?: string;
}): [FilePatch, PatchStats] {
    const filePatches = parsePatchText(args.patch_text);
    if (filePatches.length === 0) {
        throw new Error("No files were modified.");
    }
    if (filePatches.length !== 1) {
        throw new Error("Patch must update exactly one file.");
    }

    const filePatch = validateSingleFilePatch(
        filePatches[0]!,
        args.target_path,
    );
    return [filePatch, collectPatchStats(filePatches)];
}

/** Apply parsed patch chunks to file text while preserving trailing-newline state. */
export function applyPatchChunksToText(args: {
    original_text: string;
    file_path: string;
    chunks: PatchChunk[];
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
    const updatedLines = [...originalLines];
    for (const [startIndex, replacedLineCount, newLines] of replacements
        .slice()
        .reverse()) {
        updatedLines.splice(startIndex, replacedLineCount, ...newLines);
    }

    if (updatedLines.length === 0) {
        return "";
    }
    return `${updatedLines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

/** Ensure the parsed patch targets the expected file and uses supported features. */
function validateSingleFilePatch(
    filePatch: FilePatch,
    targetPath?: string,
): FilePatch {
    if (targetPath !== undefined) {
        const expectedPath = normalizePatchPath(targetPath);
        const actualPath = normalizePatchPath(filePatch.path);
        if (actualPath !== expectedPath) {
            throw new Error(
                `Patch targets ${JSON.stringify(filePatch.path)}, expected ${JSON.stringify(targetPath)}.`,
            );
        }
    }
    if (filePatch.move_path !== null) {
        throw new Error("Move operations are not supported.");
    }
    return filePatch;
}

/** Strip any leading slashes so patch paths compare consistently. */
function normalizePatchPath(path: string): string {
    return path.replace(/^\/+/, "");
}

/** Parse raw patch text into ordered per-file patch sections. */
function parsePatchText(patchText: string): FilePatch[] {
    const stripped = patchText.trim();
    if (!stripped) {
        throw new Error("Patch input is empty.");
    }

    const lines = stripped.split(/\r?\n/);
    if (lines[0]?.trim() !== BEGIN_PATCH_MARKER) {
        throw new Error(
            "The first line of the patch must be '*** Begin Patch'.",
        );
    }
    if (lines.at(-1)?.trim() !== END_PATCH_MARKER) {
        throw new Error("The last line of the patch must be '*** End Patch'.");
    }

    const filePatches: FilePatch[] = [];
    let index = 1;
    while (index < lines.length - 1) {
        const line = lines[index]?.trim() ?? "";
        if (!line) {
            index += 1;
            continue;
        }
        if (!line.startsWith(UPDATE_FILE_MARKER)) {
            throw new Error(
                `Unsupported patch header: ${JSON.stringify(lines[index])}`,
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

        const chunks: PatchChunk[] = [];
        let allowMissingContextMarker = true;
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

            const [chunk, consumed] = parsePatchChunk(
                lines.slice(index, lines.length - 1),
                allowMissingContextMarker,
            );
            chunks.push(chunk);
            allowMissingContextMarker = false;
            index += consumed;
        }

        if (chunks.length === 0) {
            throw new Error(
                `Update file patch for ${JSON.stringify(path)} is empty.`,
            );
        }
        filePatches.push({ path, move_path: movePath, chunks });
    }

    return filePatches;
}

/** Parse a single chunk and report how many source lines it consumed. */
function parsePatchChunk(
    lines: string[],
    allowMissingContextMarker: boolean,
): [PatchChunk, number] {
    if (lines.length === 0) {
        throw new Error("Patch chunk does not contain any lines.");
    }

    let index = 0;
    let changeContext: string | null = null;
    const first = lines[index] ?? "";
    if (first === EMPTY_CHANGE_CONTEXT_MARKER) {
        index += 1;
    } else if (first.startsWith(CHANGE_CONTEXT_MARKER)) {
        changeContext = first.slice(CHANGE_CONTEXT_MARKER.length);
        index += 1;
    } else if (!allowMissingContextMarker) {
        throw new Error(
            `Expected patch chunk to start with @@ context marker, got ${JSON.stringify(first)}.`,
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
            throw new Error(
                "Patch change lines must start with ' ', '+', or '-'.",
            );
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
            throw new Error(
                `Invalid patch line prefix ${JSON.stringify(prefix)}.`,
            );
        }
        changeCount += 1;
        index += 1;
    }

    if (changeCount === 0) {
        throw new Error("Patch chunk has no change lines.");
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

/** Aggregate chunk and line-change totals across parsed file patches. */
function collectPatchStats(filePatches: FilePatch[]): PatchStats {
    let chunkCount = 0;
    let linesRemoved = 0;
    let linesInserted = 0;

    for (const filePatch of filePatches) {
        chunkCount += filePatch.chunks.length;
        for (const chunk of filePatch.chunks) {
            linesRemoved += chunk.removed_lines;
            linesInserted += chunk.inserted_lines;
        }
    }

    return {
        chunk_count: chunkCount,
        lines_removed: linesRemoved,
        lines_inserted: linesInserted,
        lines_touched: linesRemoved + linesInserted,
    };
}

/** Return whether a line starts the next chunk or file-level patch marker. */
function isChunkBoundary(line: string): boolean {
    const stripped = line.trim();
    return (
        stripped.startsWith("*** ") ||
        line === EMPTY_CHANGE_CONTEXT_MARKER ||
        line.startsWith(CHANGE_CONTEXT_MARKER)
    );
}

/** Resolve each patch chunk to a concrete list replacement against the original lines. */
function computeReplacements(
    originalLines: string[],
    filePath: string,
    chunks: PatchChunk[],
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

/** Advance the search cursor to the chunk's context anchor when one is present. */
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

/** Find the splice instruction that applies one parsed patch chunk. */
function findChunkReplacement(
    lines: string[],
    filePath: string,
    chunk: PatchChunk,
    start: number,
): Replacement {
    if (chunk.old_lines.length === 0) {
        return [lines.length, 0, chunk.new_lines];
    }

    let oldLines = chunk.old_lines;
    let newLines = chunk.new_lines;
    let matchIndex = seekSequence({
        lines,
        pattern: oldLines,
        start,
        eof: chunk.is_end_of_file,
    });
    if (matchIndex === null && oldLines.at(-1) === "") {
        oldLines = oldLines.slice(0, -1);
        if (newLines.at(-1) === "") {
            newLines = newLines.slice(0, -1);
        }
        matchIndex = seekSequence({
            lines,
            pattern: oldLines,
            start,
            eof: chunk.is_end_of_file,
        });
    }

    if (matchIndex !== null) {
        return [matchIndex, oldLines.length, newLines];
    }
    throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`,
    );
}

/** Find the next matching line sequence using progressively looser normalizers. */
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
    const searchStart =
        eof && lines.length >= pattern.length ? maxStart : start;
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

/** Check whether normalized lines match the expected pattern at one start index. */
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

/** Replace smart punctuation and unusual spaces with ASCII equivalents. */
function normalizePunctuation(value: string): string {
    return Array.from(
        value,
        (char) => PUNCTUATION_TRANSLATION[char] ?? char,
    ).join("");
}

/** Collapse internal whitespace runs to single spaces for fuzzy matching. */
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
