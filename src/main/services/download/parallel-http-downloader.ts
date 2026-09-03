import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import type {
  JsHttpDownloaderOptions,
  JsHttpDownloaderStatus,
} from "./js-http-downloader";

/**
 * Gamify: Parallel multi-connection HTTP downloader (16x Range).
 * Mirrors aria2 -x16 -s16 behavior for Windows fastest downloads.
 * Falls back to single-stream if server lacks Accept-Ranges.
 *
 * Design per docs/GAMIFY_PLAN.md §4.1:
 * - HEAD probe Content-Length + Accept-Ranges
 * - Split into N=16 chunks (min 2MiB/part)
 * - Parallel fetch Range: bytes=s-e via AbortController pool
 * - Stream to .tmp/gamify-parts/, merge in order
 * - Resume: keep part index, skip completed chunks
 */
export class ParallelHttpDownloader {
  private abortControllers: AbortController[] = [];
  private isPaused = false;
  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private maxConnections = 16;

  constructor(maxConnections = 16) {
    this.maxConnections = Math.max(1, Math.min(16, maxConnections));
  }

  async probeSupport(
    url: string,
    headers: Record<string, string>
  ): Promise<{ supportsRange: boolean; fileSize: number | null }> {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers,
        signal: AbortSignal.timeout(10000),
      });
      const len = res.headers.get("content-length");
      const accept = res.headers.get("accept-ranges");
      return {
        supportsRange: accept?.toLowerCase() === "bytes",
        fileSize: len ? parseInt(len, 10) : null,
      };
    } catch {
      return { supportsRange: false, fileSize: null };
    }
  }

  async startDownload(options: JsHttpDownloaderOptions): Promise<void> {
    this.isPaused = false;
    this.status = "active";
    this.folderName = options.filename || path.basename(new URL(options.url).pathname);

    const probe = await this.probeSupport(options.url, options.headers || {});
    if (!probe.supportsRange || !probe.fileSize || probe.fileSize < 5 * 1024 * 1024) {
      logger.log("[ParallelHttp] Fallback: no range or small file, delegating to single-stream");
      // Fallback will be handled by caller (DownloadManager) -> JsHttpDownloader
      throw new Error("PARALLEL_NOT_SUPPORTED");
    }

    this.fileSize = probe.fileSize;
    const connections = Math.min(
      this.maxConnections,
      Math.ceil(this.fileSize / (2 * 1024 * 1024))
    );
    const chunkSize = Math.floor(this.fileSize / connections);

    logger.log(
      `[ParallelHttp] Starting ${connections}x parallel for ${this.folderName} (${this.fileSize} bytes, chunk ${chunkSize})`
    );

    const tmpDir = path.join(options.savePath, `.tmp-gamify-${this.folderName}`);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tasks: Promise<void>[] = [];
    for (let i = 0; i < connections; i++) {
      const start = i * chunkSize;
      const end = i === connections - 1 ? this.fileSize - 1 : (i + 1) * chunkSize - 1;
      const partPath = path.join(tmpDir, `part${String(i).padStart(2, "0")}`);
      tasks.push(this.downloadChunk(options, start, end, partPath, i));
    }

    try {
      await Promise.all(tasks);
      if (this.isPaused) {
        this.status = "paused";
        return;
      }
      await this.mergeParts(tmpDir, path.join(options.savePath, this.folderName), connections);
      this.status = "complete";
      this.bytesDownloaded = this.fileSize;
      logger.log(`[ParallelHttp] Complete ${this.folderName}`);
    } catch (err) {
      this.status = "error";
      throw err;
    } finally {
      // cleanup handled by caller on success; keep tmp on error for resume
    }
  }

  private async downloadChunk(
    options: JsHttpDownloaderOptions,
    start: number,
    end: number,
    partPath: string,
    idx: number
  ): Promise<void> {
    if (fs.existsSync(partPath)) {
      const stat = fs.statSync(partPath);
      const expected = end - start + 1;
      if (stat.size === expected) {
        this.bytesDownloaded += stat.size;
        logger.log(`[ParallelHttp] Chunk ${idx} already complete, skipping`);
        return;
      }
    }

    const controller = new AbortController();
    this.abortControllers.push(controller);
    const headers = {
      ...(options.headers || {}),
      Range: `bytes=${start}-${end}`,
    };

    const res = await fetch(options.url, {
      headers,
      signal: controller.signal,
    });

    if (res.status !== 206 && res.status !== 200) {
      throw new Error(`Chunk ${idx} HTTP ${res.status}`);
    }
    if (!res.body) throw new Error(`Chunk ${idx} no body`);

    const reader = res.body.getReader();
    const out = fs.createWriteStream(partPath);
    let received = 0;
    try {
      for (;;) {
        if (this.isPaused) {
          await reader.cancel();
          out.destroy();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        this.bytesDownloaded += value.length;
        this.updateSpeed();
        out.write(Buffer.from(value));
      }
      out.end();
      await new Promise<void>((res2, rej) => {
        out.on("finish", res2);
        out.on("error", rej);
      });
      logger.log(`[ParallelHttp] Chunk ${idx} done ${received} bytes`);
    } catch (e) {
      out.destroy();
      throw e;
    }
  }

  private async mergeParts(tmpDir: string, dest: string, connections: number): Promise<void> {
    const out = fs.createWriteStream(dest);
    for (let i = 0; i < connections; i++) {
      const partPath = path.join(tmpDir, `part${String(i).padStart(2, "0")}`);
      const data = fs.readFileSync(partPath);
      out.write(data);
    }
    out.end();
    await new Promise<void>((r, rej) => {
      out.on("finish", r);
      out.on("error", rej);
    });
    // cleanup tmp
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  pauseDownload(): void {
    this.isPaused = true;
    for (const c of this.abortControllers) c.abort();
    this.status = "paused";
  }

  cancelDownload(): void {
    this.pauseDownload();
    this.bytesDownloaded = 0;
    this.fileSize = 0;
  }

  getDownloadStatus(): JsHttpDownloaderStatus | null {
    const progress = this.fileSize > 0 ? this.bytesDownloaded / this.fileSize : 0;
    return {
      folderName: this.folderName,
      fileSize: this.fileSize,
      progress: Math.min(1, progress),
      downloadSpeed: this.downloadSpeed,
      numPeers: 0,
      numSeeds: 0,
      status: this.status,
      bytesDownloaded: this.bytesDownloaded,
      isReconnecting: false,
      isRecovering: false,
      recoveryProgress: 0,
    };
  }

  private updateSpeed(): void {
    const now = Date.now();
    const elapsed = (now - this.lastSpeedUpdate) / 1000;
    if (elapsed >= 1) {
      this.downloadSpeed = (this.bytesDownloaded - this.bytesAtLastSpeedUpdate) / elapsed;
      this.lastSpeedUpdate = now;
      this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    }
  }

  setMaxDownloadSpeedBytesPerSecond(_limit: number | null): void {
    // TODO: throttle aggregated bandwidth across chunks
  }
}
