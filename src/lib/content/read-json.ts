import { readFile } from "node:fs/promises";
import path from "node:path";

export type ContentRoot = "content" | "generated";

const projectRoot = process.cwd();
const rootDirectories: Record<ContentRoot, string> = {
  content: path.join(projectRoot, "content"),
  generated: path.join(projectRoot, "generated")
};
const readCache = new Map<string, Promise<unknown>>();

function resolveJsonPath(root: ContentRoot, fileName: string): string {
  if (!fileName.endsWith(".json")) {
    throw new Error(`内容文件必须是 JSON：${fileName}`);
  }
  if (fileName.includes("\0") || path.posix.isAbsolute(fileName) || path.win32.isAbsolute(fileName)) {
    throw new Error(`内容文件必须使用安全的相对路径：${fileName}`);
  }
  const segments = fileName.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`内容文件路径包含无效片段：${fileName}`);
  }
  const rootDirectory = path.resolve(rootDirectories[root]);
  const filePath = path.resolve(rootDirectory, ...segments);
  if (!filePath.startsWith(`${rootDirectory}${path.sep}`)) {
    throw new Error(`内容文件超出允许的根目录：${fileName}`);
  }
  return filePath;
}

export function readContentJson<T>(root: ContentRoot, fileName: string): Promise<T> {
  const filePath = resolveJsonPath(root, fileName);
  const cacheKey = `${root}:${fileName}`;
  const cached = readCache.get(cacheKey);
  if (cached) return cached as Promise<T>;

  const pending = readFile(filePath, { encoding: "utf8", flag: "r" })
    .then((source) => JSON.parse(source) as T)
    .catch((error: unknown) => {
      readCache.delete(cacheKey);
      throw error;
    });
  readCache.set(cacheKey, pending);
  return pending;
}

export async function readOptionalContentJson<T>(
  root: ContentRoot,
  fileName: string
): Promise<T | null> {
  try {
    return await readContentJson<T>(root, fileName);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function clearContentReadCache(): void {
  readCache.clear();
}
