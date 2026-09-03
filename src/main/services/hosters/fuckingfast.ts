import axios from "axios";
import { logger } from "@main/services";

export const HOSTER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

export async function extractHosterFilename(
  url: string,
  directUrl?: string
): Promise<string> {
  if (url.includes("#")) {
    const fragment = url.split("#")[1];
    if (fragment && !fragment.startsWith("http")) {
      return fragment;
    }
  }

  if (directUrl) {
    try {
      const response = await axios.head(directUrl, {
        timeout: 10000,
        headers: { "User-Agent": HOSTER_USER_AGENT },
      });

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition) {
        const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (filenameMatch && filenameMatch[1]) {
          return filenameMatch[1].replace(/['"]/g, "");
        }
      }
    } catch {
      // Ignore errors
    }

    const urlPath = new URL(directUrl).pathname;
    const filename = urlPath.split("/").pop()?.split("?")[0];
    if (filename) {
      return filename;
    }
  }

  return "downloaded_file";
}

export function handleHosterError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      throw new Error("File not found");
    }
    if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (error.response?.status === 403) {
      throw new Error("Access denied. File may be private or deleted.");
    }
    throw new Error(`Network error: ${error.response?.status || "Unknown"}`);
  }
  throw error;
}

// ============================================
// FuckingFast API Class
// ============================================
export class FuckingFastApi {
  private static readonly FUCKINGFAST_DOMAINS = ["fuckingfast.co"];

  private static readonly FUCKINGFAST_REGEX =
    /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]*)"\)/;

  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.FUCKINGFAST_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  private static async shouldAutoReResolve(): Promise<boolean> {
    try {
      const { db } = await import("@main/level");
      const { levelKeys } = await import("@main/level/sublevels/keys");
      const prefs = await db.get<string, { gamifyAutoReResolve?: boolean } | null>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      ).catch(() => null);
      return prefs?.gamifyAutoReResolve ?? true;
    } catch {
      return true;
    }
  }

  private static async getFuckingFastDirectLink(
    url: string,
    retries = 3
  ): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.log(
          `[FuckingFast] Starting download link extraction for: ${url} (attempt ${attempt}/${retries})`
        );
        const response = await axios.get(url, {
          headers: {
            "User-Agent": HOSTER_USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://fitgirl-repacks.site/",
          },
          timeout: 30000,
          // Gamify: follow redirects, allow Cloudflare challenge pages to surface
          maxRedirects: 5,
          validateStatus: (s) => s < 500,
        });

        const html: string = response.data ?? "";

        // Cloudflare / anti-bot gate — Hydra upstream misses this, FitFast uses Camoufox.
        // Detect and give actionable error instead of regex miss. Respects gamifyAutoReResolve pref.
        if (
          html.includes("Attention Required!") ||
          html.includes("cf-challenge") ||
          html.includes("cf-turnstile") ||
          response.status === 503 ||
          response.headers["cf-mitigated"] === "challenge"
        ) {
          const autoReResolve = await FuckingFastApi.shouldAutoReResolve();
          logger.warn(
            `[FuckingFast] Cloudflare challenge detected (status ${response.status}, autoReResolve=${autoReResolve}) — retry ${attempt}/${retries}`
          );
          if (autoReResolve && attempt < retries) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          if (!autoReResolve) {
            throw new Error(
              "FuckingFast is behind Cloudflare challenge (auto re-resolve disabled in Gamify Settings). Enable it or use TorBox/Real-Debrid."
            );
          }
          throw new Error(
            "FuckingFast is behind Cloudflare challenge. Try again in 30s or use TorBox/Real-Debrid cached link."
          );
        }

        if (html.toLowerCase().includes("rate limit")) {
          logger.error(`[FuckingFast] Rate limit detected`);
          throw new Error(
            "Rate limit exceeded. Please wait a few minutes and try again."
          );
        }

        if (html.includes("File Not Found Or Deleted")) {
          logger.error(`[FuckingFast] File not found or deleted`);
          throw new Error("File not found or deleted");
        }

        // Upstream regex covers window.open("https://fuckingfast.co/dl/...").
        // Gamify also handles newer variant: window.open('https://fuckingfast.co/dl/...') and direct href.
        const regexes = [
          this.FUCKINGFAST_REGEX,
          /window\.open\('https:\/\/fuckingfast\.co\/dl\/[^']*'\)/,
          /href="(https:\/\/fuckingfast\.co\/dl\/[^"]*)"/,
        ];
        let direct: string | undefined;
        for (const re of regexes) {
          const m = re.exec(html);
          if (m?.[1]) {
            direct = m[1].replace(/^'/, "").replace(/'$/, "").replace(/"/g, "");
            // normalize single-quote wrapper variant
            if (direct.startsWith("window.open(")) {
              const inner = /window\.open\(['"]([^'"]+)['"]\)/.exec(direct);
              if (inner?.[1]) direct = inner[1];
            }
            break;
          }
        }
        // also try direct extraction without capture group for single-quote regex
        if (!direct) {
          const alt = /window\.open\('https:\/\/fuckingfast\.co\/dl\/[^']*'\)/.exec(html);
          if (alt?.[0]) {
            const im = /'(https:\/\/fuckingfast\.co\/dl\/[^']*)'/.exec(alt[0]);
            if (im?.[1]) direct = im[1];
          }
        }

        if (!direct) {
          logger.error(`[FuckingFast] Could not extract download link`);
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          throw new Error("Could not extract download link from page");
        }

        logger.log(`[FuckingFast] Successfully extracted direct link`);
        return direct;
      } catch (error) {
        // Retry on transient network errors (ETIMEDOUT, ECONNRESET) up to retries
        const isTransient =
          axios.isAxiosError(error) &&
          (!error.response || error.response.status >= 500);
        if (isTransient && attempt < retries) {
          logger.warn(`[FuckingFast] Transient error, retrying ${attempt}/${retries}: ${error}`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        logger.error(`[FuckingFast] Error:`, error);
        handleHosterError(error);
      }
    }
    // Should be unreachable due to handleHosterError throw, but TS needs return
    throw new Error("FuckingFast extraction failed after retries");
  }

  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.FUCKINGFAST_DOMAINS.join(", ")}`
      );
    }
    return this.getFuckingFastDirectLink(url);
  }

  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    return extractHosterFilename(url, directUrl);
  }
}
