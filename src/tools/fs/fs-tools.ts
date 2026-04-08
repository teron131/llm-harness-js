/** Sandboxed filesystem tool wrappers. */

import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
    applyPatchChunksToText,
    parseSingleFilePatchWithStats,
} from "./apply-patch.js";
import {
    editHashline,
    formatHashlineText,
    type HashlineEdit,
    HashlineEditSchema,
} from "./hashline.js";

const PATH_TRAVERSAL_ERROR = "Path traversal not allowed";
const PATH_OUTSIDE_ROOT_ERROR = "Path outside root";

const READ_TEXT_SCHEMA = z.object({
    path: z.string(),
});

const WRITE_TEXT_SCHEMA = z.object({
    path: z.string(),
    text: z.string(),
});

const PATCH_SCHEMA = z.object({
    patch: z.string(),
});

const HASHLINE_EDIT_SCHEMA = z.object({
    path: z.string(),
    edits: z.array(HashlineEditSchema),
});

const EDIT_WITH_ED_SCHEMA = z.object({
    path: z.string(),
    script: z.string(),
});

class SandboxFS {
    readonly rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
    }

    resolve(userPath: string): string {
        const cleanedPath = userPath.trim();
        if (!cleanedPath) {
            throw new Error("Empty path");
        }
        if (cleanedPath.startsWith("~")) {
            throw new Error(PATH_TRAVERSAL_ERROR);
        }

        const virtualPath = cleanedPath.startsWith("/")
            ? cleanedPath
            : `/${cleanedPath}`;
        if (virtualPath.includes("..")) {
            throw new Error(PATH_TRAVERSAL_ERROR);
        }

        const resolvedRoot = resolve(this.rootDir);
        const resolvedPath = resolve(resolvedRoot, virtualPath.slice(1));

        const relPath = relative(resolvedRoot, resolvedPath);
        if (relPath.startsWith("..") || isAbsolute(relPath)) {
            throw new Error(PATH_OUTSIDE_ROOT_ERROR);
        }

        return resolvedPath;
    }

    async requireFile(path: string): Promise<string> {
        const filePath = this.resolve(path);
        try {
            const fileStat = await stat(filePath);
            if (fileStat.isFile()) {
                return filePath;
            }
        } catch {
            // Fall through to the not-found error below.
        }
        throw new Error(`File not found: ${path}`);
    }

    async readText(path: string): Promise<string> {
        return readFile(await this.requireFile(path), "utf-8");
    }

    async writeText(path: string, text: string): Promise<void> {
        const filePath = this.resolve(path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, text, "utf-8");
    }

    async applyPatch(patch: string): Promise<string> {
        const [filePatch] = parseSingleFilePatchWithStats({
            patch_text: patch,
        });
        const path = `/${filePatch.path.replace(/^\/+/, "")}`;
        await this.updateExistingText(path, (originalText) =>
            applyPatchChunksToText({
                original_text: originalText,
                file_path: path,
                chunks: filePatch.chunks,
            }),
        );
        return `Patched ${path}`;
    }

    async readHashline(path: string): Promise<string> {
        return formatHashlineText(await this.readText(path));
    }

    async editHashline(path: string, edits: HashlineEdit[]): Promise<string> {
        return this.updateExistingText(path, (originalText) =>
            editHashline(originalText, edits),
        );
    }

    private async updateExistingText(
        path: string,
        transform: (text: string) => string | Promise<string>,
    ): Promise<string> {
        const originalText = await this.readText(path);
        const updatedText = await transform(originalText);
        await this.writeText(path, updatedText);
        return updatedText;
    }
}

async function runEdScript(filePath: string, script: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn("ed", ["-s", filePath], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stderr = "";
        let stdout = "";

        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });

        child.on("error", (error) => {
            rejectPromise(error);
        });

        child.on("close", (code) => {
            if (code !== 0) {
                const output = (stderr || stdout).trim();
                rejectPromise(new Error(`ed failed (code=${code}): ${output}`));
                return;
            }
            resolvePromise();
        });

        child.stdin.write(script);
        child.stdin.end();
    });
}

function createFsTool<Schema extends z.ZodTypeAny, Output>(
    name: string,
    description: string,
    schema: Schema,
    invoke: (input: z.infer<Schema>) => Promise<Output>,
) {
    return tool(invoke, {
        name,
        description,
        schema,
    });
}

export function makeFsTools({ rootDir }: { rootDir: string }) {
    const sandboxFs = new SandboxFS(resolve(rootDir));

    const fsReadText = createFsTool(
        "fs_read_text",
        "Read a UTF-8 text file from the sandboxed workspace.",
        READ_TEXT_SCHEMA,
        ({ path }) => sandboxFs.readText(path),
    );

    const fsWriteText = createFsTool(
        "fs_write_text",
        "Write a UTF-8 text file into the sandboxed workspace.",
        WRITE_TEXT_SCHEMA,
        async ({ path, text }): Promise<string> => {
            await sandboxFs.writeText(path, text);
            return `Wrote ${path}`;
        },
    );

    const fsPatch = createFsTool(
        "fs_patch",
        "Apply a single-file patch to an existing UTF-8 text file.",
        PATCH_SCHEMA,
        ({ patch }) => sandboxFs.applyPatch(patch),
    );

    const fsReadHashline = createFsTool(
        "fs_read_hashline",
        "Read a UTF-8 text file rendered as `LINE#HASH:content` entries.",
        READ_TEXT_SCHEMA,
        ({ path }) => sandboxFs.readHashline(path),
    );

    const fsEditHashline = createFsTool(
        "fs_edit_hashline",
        "Apply hashline edits to an existing UTF-8 text file.",
        HASHLINE_EDIT_SCHEMA,
        ({ path, edits }) => sandboxFs.editHashline(path, edits),
    );

    const fsEditWithEd = createFsTool(
        "fs_edit_with_ed",
        "Edit a file by running an `ed` script against it.",
        EDIT_WITH_ED_SCHEMA,
        async ({ path, script }): Promise<string> => {
            const filePath = await sandboxFs.requireFile(path);
            await runEdScript(filePath, script);
            return `Edited ${path}`;
        },
    );

    return [
        fsReadText,
        fsWriteText,
        fsPatch,
        fsReadHashline,
        fsEditHashline,
        fsEditWithEd,
    ] as const;
}
