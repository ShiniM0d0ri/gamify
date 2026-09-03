import { logger } from "../logger";

/**
 * Gamify Tier C: Mirror racing — pick fastest host for same file.
 * Used when GameRepack provides multiple uris for same repack (e.g., FitGirl host1=FuckingFast, host2=Datanodes).
 * For single uri, falls back to direct.
 *
 * Implementation: parallel HEAD + 1MiB Range speed probe (2s timeout), keep fastest.
 * If probe fails, fallback to first successful getDirectLink.
 */
export interface MirrorCandidate {
  url: string;
  directUrl?: string;
  hoster: string;
}

export async function raceMirrors(
  candidates: MirrorCandidate[],
  timeoutMs = 4000
): Promise<MirrorCandidate> {
  if (candidates.length === 0) throw new Error("No mirror candidates");
  if (candidates.length === 1) return candidates[0];

  logger.log(`[MirrorRacer] Racing ${candidates.length} mirrors: ${candidates.map((c) => c.hoster).join(", ")}`);

  const probes = candidates.map(async (c) => {
    const start = Date.now();
    try {
      const target = c.directUrl || c.url;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(target, {
        method: "HEAD",
        signal: controller.signal,
        headers: { Range: "bytes=0-1048575" },
      });
      clearTimeout(t);
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const len = res.headers.get("content-length");
      const accept = res.headers.get("accept-ranges");
      const elapsed = Date.now() - start;
      // Score: prefer Accept-Ranges + larger content-length + lower latency
      const score = (accept === "bytes" ? 1000 : 0) - elapsed + (len ? Math.min(500, parseInt(len, 10) / 1e6) : 0);
      logger.log(`[MirrorRacer] ${c.hoster} probe ok len=${len} accept=${accept} elapsed=${elapsed}ms score=${score}`);
      return { candidate: c, score, elapsed };
    } catch (e) {
      const elapsed = Date.now() - start;
      logger.warn(`[MirrorRacer] ${c.hoster} probe failed ${e} elapsed=${elapsed}ms`);
      return { candidate: c, score: Number.NEGATIVE_INFINITY, elapsed };
    }
  });

  const results = await Promise.all(probes);
  results.sort((a, b) => b.score - a.score);
  const winner = results[0];
  if (winner.score === Number.NEGATIVE_INFINITY) {
    logger.warn("[MirrorRacer] All probes failed, fallback to first candidate");
    return candidates[0];
  }
  logger.log(`[MirrorRacer] Winner ${winner.candidate.hoster} score=${winner.score}`);
  return winner.candidate;
}

export async function resolveWithAutoReResolve<T>(
  fn: () => Promise<T>,
  shouldRetry: boolean,
  maxRetries = 2
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!shouldRetry || attempt > maxRetries) break;
      logger.warn(`[MirrorRacer] Auto re-resolve attempt ${attempt} failed, retrying: ${e}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}
