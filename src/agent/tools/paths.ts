import * as fs from "node:fs/promises";
import * as path from "node:path";
import { allowedRoots } from "../../utils/config";

export function expandPath(target: string): string {
  if (!target) return allowedRoots()[0];
  return path.resolve(target.startsWith("~") ? path.join(process.env.HOME ?? "", target.slice(1)) : target);
}

const inside = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root + path.sep);

/**
 * Resolves a path and refuses anything outside the workspace. The realpath check
 * matters: a symlink inside Documents that points at ~/Library would otherwise
 * pass the lexical prefix test.
 */
export async function resolveInWorkspace(target: string): Promise<string> {
  const roots = allowedRoots();
  const absolute = expandPath(target);
  if (!roots.some((root) => inside(absolute, root))) {
    throw new Error(`${absolute} is outside the allowed folders (${roots.join(", ")})`);
  }

  let existing = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }

  const realRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return root;
      }
    })
  );
  const realExisting = await fs.realpath(existing);
  const real = missing.length ? path.join(realExisting, ...missing) : realExisting;

  if (!realRoots.some((root) => inside(real, root))) {
    throw new Error(`${absolute} resolves outside the allowed folders through a symlink`);
  }
  return absolute;
}
