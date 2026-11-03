import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BONSAI_4B, hfResolveUrl, type GgufModelEntry } from "./catalog";
import { ggufPath } from "../utils/config";
import { assertNetworkAllowed } from "../utils/network";
import { availableBytes, formatMegabytes } from "../utils/disk";
import logger from "../utils/logger";
import type { ModelDownloadStatus } from "../utils/types";

const REPORT_INTERVAL_MS = 250;

/**
 * The weights land whole on one volume, so the download needs the remaining bytes
 * plus room for whatever else writes while it runs.
 */
const HEADROOM_BYTES = 64_000_000;

/** What the downloader writes and where it checks for room; a test points it at a temp folder. */
export interface ModelTarget {
  entry?: GgufModelEntry;
  dest?: string;
  freeBytes?: (targetPath: string) => number | null;
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
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

/** The four bytes every GGUF starts with; the cheapest proof that a picked file is a model. */
function hasGgufMagic(filePath: string): boolean {
  let handle: number;
  try {
    handle = fs.openSync(filePath, "r");
  } catch {
    return false;
  }
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(handle, head, 0, 4, 0) === 4 && head.toString("utf8") === "GGUF";
  } catch {
    return false;
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Downloads the model into `<model>.part`, resumes with an HTTP Range request, and
 * only moves it into place after the pinned SHA-256 matches. A cancelled download
 * stays on disk so the next attempt resumes instead of starting over.
 */
export class ModelDownloader {
  private controller: AbortController | null = null;
  private running = false;
  private hydrated = false;
  private status: ModelDownloadStatus = {
    phase: "idle",
    bytesReceived: 0,
    totalBytes: 0,
    speedBytesPerSecond: 0,
    verified: null,
  };

  constructor(
    private readonly onUpdate: (status: ModelDownloadStatus) => void = () => undefined,
    private readonly target: ModelTarget = {}
  ) {}

  private get entry(): GgufModelEntry {
    return this.target.entry ?? BONSAI_4B;
  }

  private get dest(): string {
    return this.target.dest ?? ggufPath();
  }

  /** The room still missing on the volume, or null when the volume cannot be read. */
  private space(bytesMissing: number): { requiredBytes: number; availableBytes: number | null } {
    const free = (this.target.freeBytes ?? availableBytes)(path.dirname(this.dest));
    return { requiredBytes: bytesMissing + HEADROOM_BYTES, availableBytes: free };
  }

  /** Runs after app ready: reflects installed weights or a `.part` left by a previous run. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.status = { ...this.status, totalBytes: this.entry.bytes };
    if (fs.existsSync(this.dest)) {
      this.status = {
        ...this.status,
        phase: "done",
        bytesReceived: fileSize(this.dest),
        totalBytes: this.entry.bytes,
      };
      return;
    }
    const partial = fileSize(`${this.dest}.part`);
    if (partial > 0) {
      this.status = {
        ...this.status,
        phase: "cancelled",
        bytesReceived: partial,
        totalBytes: this.entry.bytes,
      };
    }
  }

  get current(): ModelDownloadStatus {
    this.hydrate();
    const missing = this.installed ? 0 : Math.max(0, this.entry.bytes - this.status.bytesReceived);
    return { ...this.status, ...this.space(missing) };
  }

  get installed(): boolean {
    this.hydrate();
    return fs.existsSync(this.dest);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private emit(patch: Partial<ModelDownloadStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onUpdate(this.status);
  }

  /** A refusal the user can act on, reported the same way as a failed download. */
  private fail(message: string): ModelDownloadStatus {
    this.emit({
      phase: "error",
      speedBytesPerSecond: 0,
      verified: null,
      ...this.space(this.entry.bytes - this.status.bytesReceived),
      error: message,
    });
    logger.warn("model.download.refused", { error: message });
    return this.status;
  }

  cancel(): void {
    this.controller?.abort();
  }

  private async finalize(part: string, dest: string, received: number, total: number): Promise<ModelDownloadStatus> {
    this.emit({
      phase: "verifying",
      bytesReceived: received,
      totalBytes: total,
      speedBytesPerSecond: 0,
      verified: null,
      error: undefined,
    });

    const digest = await hashFile(part);
    if (digest !== this.entry.sha256) {
      fs.rmSync(part, { force: true });
      throw new Error("Downloaded model failed its SHA-256 check. Please download it again.");
    }

    fs.renameSync(part, dest);
    this.emit({
      phase: "done",
      bytesReceived: received,
      totalBytes: total,
      speedBytesPerSecond: 0,
      verified: true,
      error: undefined,
    });
    logger.info("model.download.done", { bytes: received, digest });
    return this.status;
  }

  async download(): Promise<ModelDownloadStatus> {
    if (this.running) return this.status;
    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const dest = this.dest;
    const part = `${dest}.part`;

    try {
      assertNetworkAllowed("model-download");
      if (this.installed) {
        this.emit({
          phase: "done",
          bytesReceived: fileSize(dest),
          totalBytes: this.entry.bytes,
          speedBytesPerSecond: 0,
          verified: this.status.verified,
          error: undefined,
        });
        return this.status;
      }

      let existing = fileSize(part);
      if (existing > this.entry.bytes) {
        fs.rmSync(part, { force: true });
        existing = 0;
      }

      // Fully downloaded but never renamed (quit during verification): verify instead
      // of sending a Range request the server would reject with 416.
      if (existing === this.entry.bytes) {
        return await this.finalize(part, dest, existing, this.entry.bytes);
      }

      const room = this.space(this.entry.bytes - existing);
      if (room.availableBytes !== null && room.availableBytes < room.requiredBytes) {
        throw new Error(
          `Not enough free space: ${formatMegabytes(room.requiredBytes)} needed, ` +
            `${formatMegabytes(room.availableBytes)} available on this volume.`
        );
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      this.emit({
        phase: "downloading",
        bytesReceived: existing,
        totalBytes: this.entry.bytes,
        speedBytesPerSecond: 0,
        verified: null,
        ...room,
        error: undefined,
      });

      const headers: Record<string, string> = { "User-Agent": "OpenMonkey/0.9" };
      if (existing > 0) headers.Range = `bytes=${existing}-`;

      const response = await fetch(hfResolveUrl(this.entry), { headers, signal, redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}`);
      }

      let total = this.entry.bytes;
      let append = existing > 0;

      if (response.status === 206) {
        const match = response.headers.get("content-range")?.match(/\/(\d+)\s*$/);
        if (match) total = Number(match[1]);
      } else if (response.status === 200 && existing > 0) {
        // The CDN ignored our Range header; restart from zero instead of appending.
        existing = 0;
        append = false;
      }

      let received = existing;
      let lastBytes = existing;
      let lastReport = Date.now();
      let speed = 0;

      const report = (bytes: number, size: number, rate: number) => {
        if (signal.aborted) return;
        this.emit({
          phase: "downloading",
          bytesReceived: bytes,
          totalBytes: size,
          speedBytesPerSecond: rate,
          verified: null,
          error: undefined,
        });
      };

      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          const now = Date.now();
          if (now - lastReport >= REPORT_INTERVAL_MS) {
            speed = ((received - lastBytes) * 1000) / (now - lastReport);
            lastBytes = received;
            lastReport = now;
            report(received, total, speed);
          }
          callback(null, chunk);
        },
      });

      try {
        await pipeline(
          Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
          counter,
          fs.createWriteStream(part, { flags: append ? "a" : "w" })
        );
      } catch (error) {
        if (signal.aborted) {
          this.emit({ phase: "cancelled", bytesReceived: received, speedBytesPerSecond: 0, verified: null });
          logger.info("model.download.cancelled", { bytes: received });
          return this.status;
        }
        throw error;
      }

      if (total > 0 && received < total) {
        throw new Error(`Download ended early (${received} of ${total} bytes)`);
      }

      return await this.finalize(part, dest, received, total);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        phase: "error",
        bytesReceived: fileSize(part),
        speedBytesPerSecond: 0,
        verified: null,
        ...this.space(Math.max(0, this.entry.bytes - fileSize(part))),
        error: message,
      });
      logger.error("model.download.failed", { error: message });
      return this.status;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  /**
   * Puts a GGUF the user already has where the app looks for its weights. The magic
   * number is read before anything is copied and the pinned digest after, so a file
   * that is a model but not this release still loads - and the card says so instead
   * of wearing a badge it did not earn. The original file is left where it is.
   */
  async importFrom(sourcePath: string): Promise<ModelDownloadStatus> {
    const bytes = fileSize(sourcePath);
    if (bytes === 0) return this.fail("Choose a GGUF file that exists and can be read.");
    if (!hasGgufMagic(sourcePath)) return this.fail("That file is not a GGUF model.");

    const room = this.space(bytes);
    if (room.availableBytes !== null && room.availableBytes < room.requiredBytes) {
      return this.fail(
        `Not enough free space to put the model in place: ${formatMegabytes(room.requiredBytes)} needed, ` +
          `${formatMegabytes(room.availableBytes)} available on this volume.`
      );
    }

    const dest = this.dest;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(sourcePath, dest);
    const digest = await hashFile(dest);
    const verified = digest === this.entry.sha256;
    this.emit({
      phase: "done",
      bytesReceived: bytes,
      totalBytes: bytes,
      speedBytesPerSecond: 0,
      verified,
      error: verified
        ? undefined
        : "A valid GGUF, but not the pinned release: it loads, and its digest cannot match.",
    });
    logger.info("model.imported", { bytes, verified });
    return this.status;
  }

  /**
   * Frees the weights and any half-finished download. Nothing else is touched:
   * the chat history lives in the database, not next to the model.
   */
  removeInstalled(): ModelDownloadStatus {
    const dest = this.dest;
    fs.rmSync(dest, { force: true });
    fs.rmSync(`${dest}.part`, { force: true });
    // The next read must re-hydrate against an empty folder, not the cached state.
    this.hydrated = false;
    this.status = {
      phase: "idle",
      bytesReceived: 0,
      totalBytes: this.entry.bytes,
      speedBytesPerSecond: 0,
      verified: null,
    };
    this.onUpdate(this.status);
    logger.info("model.deleted", { path: dest });
    return this.status;
  }

  async verifyInstalled(): Promise<ModelDownloadStatus> {
    if (!this.installed) {
      this.emit({
        phase: "error",
        bytesReceived: 0,
        totalBytes: this.entry.bytes,
        speedBytesPerSecond: 0,
        verified: null,
        error: "The model is not downloaded yet.",
      });
      return this.status;
    }

    this.emit({
      phase: "verifying",
      bytesReceived: fileSize(this.dest),
      totalBytes: this.entry.bytes,
      speedBytesPerSecond: 0,
      verified: null,
      error: undefined,
    });

    const digest = await hashFile(this.dest);
    const verified = digest === this.entry.sha256;
    this.emit({
      phase: "done",
      bytesReceived: fileSize(this.dest),
      totalBytes: this.entry.bytes,
      speedBytesPerSecond: 0,
      verified,
      error: verified
        ? undefined
        : "The installed file does not match the pinned SHA-256. Download it again.",
    });
    logger.info("model.verify", { verified, digest });
    return this.status;
  }
}

export default ModelDownloader;
