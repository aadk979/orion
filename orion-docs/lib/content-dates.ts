import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");

/**
 * Returns the source file's modification time for a documentation route.
 *
 * The export is static, so source-file mtime is the only trustworthy freshness
 * signal available at build time. It is deliberately shared by the sitemap and
 * the page metadata so crawlers never receive competing update dates.
 */
export async function documentLastModified(segments: string[] = []): Promise<Date | undefined> {
  const normalized = segments.filter(Boolean);
  const base = normalized.join("/");

  for (const candidate of [`${base}.mdx`, path.join(base, "index.mdx")]) {
    try {
      return (await stat(path.join(CONTENT_DIR, candidate))).mtime;
    } catch {
      // A section index and a leaf page use different file shapes. Try both.
    }
  }

  return undefined;
}
