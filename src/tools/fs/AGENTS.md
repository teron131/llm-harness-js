# Codemap: `llm-harness-js/src/tools/fs`

## Scope

- Filesystem sandbox operations and transcript tag-range transformations.

## What Module Is For

- This module provides sandboxed filesystem helpers and line-tag transcript filtering utilities.

## High-signal locations

- `src/tools/fs/fs-tools.ts -> SandboxFS/makeFsTools`
- `src/tools/fs/apply-patch.ts -> parseSingleFilePatchWithStats/applyPatchChunksToText`
- `src/tools/fs/hashline.ts -> HashlineEditSchema/editHashline/formatHashlineText`
- `src/tools/fs/fast-copy.ts -> TagRangeSchema/tagContent/filterContent/untagContent`

## Repository snapshot

- High-signal files listed below form the stable architecture anchors for this module.
- Keep imports and exports aligned with these anchors when extending behavior.

## Symbol Inventory

- Primary symbols are enumerated in the high-signal locations and syntax relationship sections.
- Preserve existing exported names unless changing a public contract intentionally.

## Key takeaways per location

- `SandboxFS.resolve` enforces path normalization and root containment.
- `makeFsTools` returns read/write/patch/hashline/`ed` functions for tool-calling workflows.
- `apply-patch.ts` parses the single-file patch format and applies chunks with tolerant whitespace and punctuation matching.
- `hashline.ts` renders stable `LINE#HASH` references and validates edits against current file contents.
- `fastCopy` utilities are pure transforms used by YouTube summarizers.

## Project-specific conventions and rationale

- Keep traversal protection strict and centralized in `SandboxFS`.
- Preserve inclusive range removal semantics in `filterContent`.
- Keep text encoding behavior UTF-8 for read/write operations.
- Keep `apply-patch.ts` single-file scoped; callers should not assume multi-file patch support.
- Treat hashline refs as model-facing coordination data, not persisted file content.

## Syntax Relationships

- `agents/youtube/summarizer*.ts -> import tagContent/filterContent/untagContent`
- `fs-tools.ts -> makeFsTools -> fsReadText/fsWriteText/fsPatch/fsReadHashline/fsEditHashline/fsEditWithEd`
- `fs-tools.ts -> SandboxFS.applyPatch -> apply-patch.parseSingleFilePatchWithStats/apply-patch.applyPatchChunksToText`
- `fs-tools.ts -> SandboxFS.readHashline/editHashline -> hashline.formatHashlineText/hashline.editHashline`
- `fsTools.ts -> spawn(\"ed\", ...)` for line-oriented edits

## General approach (not rigid checklist)

- Change path-validation rules only through `SandboxFS.resolve`.
- Keep tag/range utilities deterministic and side-effect free.
- Prefer small, explicit error messages for tool-call debugging.

## Validation commands

- `cd llm-harness-js && pnpm run build`
- `/Users/teron/Projects/Agents-Config/.factory/hooks/formatter.sh`
