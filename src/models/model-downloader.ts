import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BONSAI_4B, hfResolveUrl } from "./catalog";
import { ggufPath } from "../utils/config";
import { assertNetworkAllowed } from "../utils/network";
import logger from "../utils/logger";
import type { ModelDownloadStatus } from "../utils/types";

const REPORT_INTERVAL_MS = 250;

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
    totalBytes: BONSAI_4B.bytes,
    speedBytesPerSecond: 0,
    verified: null,
  };

  constructor(private readonly onUpdate: (status: ModelDownloadStatus) => void = () => undefined) {}

  /** Runs after app ready: reflects installed weights or a `.part` left by a previous run. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const dest = ggufPath();
    if (fs.existsSync(dest)) {
      this.status = {
        ...this.status,
        phase: "done",
        bytesReceived: fileSize(dest),
        totalBytes: BONSAI_4B.bytes,
      };
      return;
    }
    const partial = fileSize(`${dest}.part`);
    if (partial > 0) {
      this.status = {
        ...this.status,
        phase: "cancelled",
        bytesReceived: partial,
        totalBytes: BONSAI_4B.bytes,
      };
    }
  }

  get current(): ModelDownloadStatus {
    this.hydrate();
    return this.status;
  }

  get installed(): boolean {
    this.hydrate();
    return fs.existsSync(ggufPath());
  }

  get isRunning(): boolean {
    return this.running;
  }

  private emit(patch: Partial<ModelDownloadStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onUpdate(this.status);
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
    if (digest !== BONSAI_4B.sha256) {
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
    const dest = ggufPath();
    const part = `${dest}.part`;

    try {
      assertNetworkAllowed("model-download");
      if (this.installed) {
        this.emit({
          phase: "done",
          bytesReceived: fileSize(dest),
          totalBytes: BONSAI_4B.bytes,
          speedBytesPerSecond: 0,
          verified: this.status.verified,
          error: undefined,
        });
        return this.status;
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let existing = fileSize(part);
      if (existing > BONSAI_4B.bytes) {
        fs.rmSync(part, { force: true });
        existing = 0;
      }

      // Fully downloaded but never renamed (quit during verification): verify instead
      // of sending a Range request the server would reject with 416.
      if (existing === BONSAI_4B.bytes) {
        return await this.finalize(part, dest, existing, BONSAI_4B.bytes);
      }

      this.emit({
        phase: "downloading",
        bytesReceived: existing,
        totalBytes: BONSAI_4B.bytes,
        speedBytesPerSecond: 0,
        verified: null,
        error: undefined,
      });

      const headers: Record<string, string> = { "User-Agent": "OpenMonkey/0.9" };
      if (existing > 0) headers.Range = `bytes=${existing}-`;

      const response = await fetch(hfResolveUrl(BONSAI_4B), { headers, signal, redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}`);
      }

      let total = BONSAI_4B.bytes;
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
        error: message,
      });
      logger.error("model.download.failed", { error: message });
      return this.status;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  async verifyInstalled(): Promise<ModelDownloadStatus> {
    if (!this.installed) {
      this.emit({
        phase: "error",
        bytesReceived: 0,
        totalBytes: BONSAI_4B.bytes,
        speedBytesPerSecond: 0,
        verified: null,
        error: "The model is not downloaded yet.",
      });
      return this.status;
    }

    this.emit({
      phase: "verifying",
      bytesReceived: fileSize(ggufPath()),
      totalBytes: BONSAI_4B.bytes,
      speedBytesPerSecond: 0,
      verified: null,
      error: undefined,
    });

    const digest = await hashFile(ggufPath());
    const verified = digest === BONSAI_4B.sha256;
    this.emit({
      phase: "done",
      bytesReceived: fileSize(ggufPath()),
      totalBytes: BONSAI_4B.bytes,
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
