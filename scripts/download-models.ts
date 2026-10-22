/**
 * Download the local model weights OpenMonkey runs on.
 *
 * Default: Bonsai-4B GGUF (works on macOS + Windows).
 * Pass --mlx to also fetch an Apple Silicon MLX snapshot (needs python3 + mlx-lm).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(ROOT, "models");

const BONSAI = {
  repo: "prism-ml/Bonsai-4B-gguf",
  file: "Bonsai-4B.gguf",
  dirName: "Bonsai-4B-gguf",
  approxBytes: 572_300_000,
};

const MLX_MODEL = {
  repo: "arcee-ai/Virtuoso-Lite-8bit-mlx",
  dirName: "Virtuoso-Lite-8bit-mlx",
};

function hfUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

async function downloadFile(url: string, dest: string, label: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  already present: ${label} (${formatBytes(fs.statSync(dest).size)})`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tempPath = `${dest}.part`;
  const hash = createHash("sha256");

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  let lastReport = 0;

  const stream = response.body as unknown as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  const out = fs.createWriteStream(tempPath);

  console.log(`  downloading ${label}${total ? ` (${formatBytes(total)})` : ""}`);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      hash.update(value);
      out.write(value);
      if (total && received - lastReport > total * 0.1) {
        lastReport = received;
        console.log(`    ${Math.round((received / total) * 100)}% of ${formatBytes(total)}`);
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });
  } finally {
    if (!out.closed) out.destroy();
  }

  fs.renameSync(tempPath, dest);
  console.log(`  saved ${dest}\n  sha256 ${hash.digest("hex")}`);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Verify the file llama.cpp reports, when the repo publishes SHA256SUMS. */
async function verifyAgainstRepoChecksums(filePath: string, repo: string, file: string): Promise<boolean> {
  try {
    const response = await fetch(hfUrl(repo, "SHA256SUMS"));
    if (!response.ok) return true;
    const sums = await response.text();
    const expected = sums
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === file)?.[0];
    if (!expected) return true;

    const actual = await hashFile(filePath);
    if (actual !== expected) {
      console.error(`  checksum mismatch: expected ${expected}, got ${actual}`);
      return false;
    }
    console.log("  checksum verified");
    return true;
  } catch {
    return true;
  }
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadBonsaiGGUF(): Promise<string> {
  console.log(`Bonsai-4B GGUF (${BONSAI.repo})\n  ~${formatBytes(BONSAI.approxBytes)}`);
  const dest = path.join(MODELS_DIR, BONSAI.dirName, BONSAI.file);
  await downloadFile(hfUrl(BONSAI.repo, BONSAI.file), dest, BONSAI.file);
  if (!(await verifyAgainstRepoChecksums(dest, BONSAI.repo, BONSAI.file))) {
    fs.rmSync(dest, { force: true });
    throw new Error(`Checksum failed for ${BONSAI.file}; re-run npm run download-models`);
  }
  return dest;
}

/**
 * MLX snapshots are safetensors directories; `mlx_lm.server` can read them directly.
 * Fetching goes through huggingface_hub so we do not re-implement the HF tree API.
 */
async function setupMLXModels(): Promise<string | null> {
  console.log(`MLX snapshot (${MLX_MODEL.repo})`);
  const dest = path.join(MODELS_DIR, MLX_MODEL.dirName);
  if (fs.existsSync(path.join(dest, "model.safetensors.index.json"))) {
    console.log(`  already present: ${dest}`);
    return dest;
  }

  try {
    await execFileAsync("python3", ["-c", "import huggingface_hub"]);
  } catch {
    console.warn("  python3 huggingface_hub is not installed - run: python3 -m pip install huggingface_hub");
    return null;
  }

  const code = `
from huggingface_hub import snapshot_download
snapshot_download(repo_id=${JSON.stringify(MLX_MODEL.repo)}, local_dir=${JSON.stringify(dest)})
`;
  await execFileAsync("python3", ["-c", code], { maxBuffer: 64 * 1024 * 1024 });
  console.log(`  saved ${dest}`);
  return dest;
}

async function main(): Promise<void> {
  const wantMlx = process.argv.includes("--mlx");
  console.log("Downloading local models for OpenMonkey\n");
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const ggufPath = await downloadBonsaiGGUF();
  console.log(`\nGGUF model ready: ${ggufPath}`);

  if (wantMlx) {
    const mlxPath = await setupMLXModels();
    if (mlxPath) console.log(`MLX model ready: ${mlxPath}`);
  } else {
    console.log("Skipped MLX snapshot (pass --mlx to fetch it).");
  }

  console.log("\nYou can now run the app with: npm run dev");
}

main().catch((error: unknown) => {
  console.error("\nModel download failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
