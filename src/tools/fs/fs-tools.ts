/** Sandboxed filesystem tool wrappers. */

import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  applyPatchHunkToText,
  parseSingleFilePatchWithStats,
} from "./apply-patch.js";
import {
  editHashline,
  formatHashlineText,
  HashlineEditSchema,
  type HashlineEdit,
} from "./hashline.js";

export const PATH_TRAVERSAL_ERROR = "Path traversal not allowed";
export const PATH_OUTSIDE_ROOT_ERROR = "Path outside root";

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

type TextTransform = (text: string) => string | Promise<string>;

export class SandboxFS {
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
    if (!(await fileExists(filePath))) {
      throw new Error(`File not found: ${path}`);
    }
    return filePath;
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
    const [hunk] = parseSingleFilePatchWithStats({ patch_text: patch });
    const path = normalizeSandboxPath(hunk.path);
    await this.updateExistingText(path, (originalText) =>
      applyPatchHunkToText({
        original_text: originalText,
        file_path: path,
        hunk,
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
    transform: TextTransform,
  ): Promise<string> {
    const originalText = await this.readText(path);
    const updatedText = await transform(originalText);
    await this.writeText(path, updatedText);
    return updatedText;
  }
}

function normalizeSandboxPath(path: string): string {
  return `/${path.replace(/^\/+/, "")}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
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

function makeFsTool<Schema extends z.ZodTypeAny, Output>(
  name: string,
  description: string,
  schema: Schema,
  invoke: (input: z.infer<Schema>) => Promise<Output>,
) {
  return tool(
    async (input: z.infer<Schema>): Promise<Output> => invoke(input),
    {
      name,
      description,
      schema,
    },
  );
}

export function makeFsTools({ rootDir }: { rootDir: string }) {
  const fs = new SandboxFS(resolve(rootDir));

  const fsReadText = makeFsTool(
    "fs_read_text",
    "Read a UTF-8 text file from the sandboxed workspace.",
    READ_TEXT_SCHEMA,
    ({ path }) => fs.readText(path),
  );

  const fsWriteText = makeFsTool(
    "fs_write_text",
    "Write a UTF-8 text file into the sandboxed workspace.",
    WRITE_TEXT_SCHEMA,
    async ({ path, text }): Promise<string> => {
      await fs.writeText(path, text);
      return `Wrote ${path}`;
    },
  );

  const fsPatch = makeFsTool(
    "fs_patch",
    "Apply a single-file patch to an existing UTF-8 text file.",
    PATCH_SCHEMA,
    ({ patch }) => fs.applyPatch(patch),
  );

  const fsReadHashline = makeFsTool(
    "fs_read_hashline",
    "Read a UTF-8 text file rendered as `LINE#HASH:content` entries.",
    READ_TEXT_SCHEMA,
    ({ path }) => fs.readHashline(path),
  );

  const fsEditHashline = makeFsTool(
    "fs_edit_hashline",
    "Apply hashline edits to an existing UTF-8 text file.",
    HASHLINE_EDIT_SCHEMA,
    ({ path, edits }) => fs.editHashline(path, edits),
  );

  const fsEditWithEd = makeFsTool(
    "fs_edit_with_ed",
    "Edit a file by running an `ed` script against it.",
    EDIT_WITH_ED_SCHEMA,
    async ({ path, script }): Promise<string> => {
      const filePath = await fs.requireFile(path);
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
