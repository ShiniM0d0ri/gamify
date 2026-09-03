import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";
import { logger } from "@main/services";

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  try {
    const existingSources = await downloadSourcesSublevel.values().all();
    const urlExists = existingSources.some((source) => source.url === url);

    if (urlExists) {
      throw new Error("Download source with this URL already exists");
    }

    let downloadSource: DownloadSource;
    try {
      downloadSource = await HydraApi.post<DownloadSource>(
        "/download-sources",
        {
          url,
        },
        { needsAuth: false }
      );
    } catch (apiError: any) {
      // Gamify: fallback for RIN direct sources (FitGirl/DODI) or when Hydra API is unreachable / source-unreachable.
      // Allows adding any URL locally so catalog can still try to use it (e.g., direct repack JSON).
      logger.warn(
        "[Gamify] HydraApi add source failed, using local fallback for",
        url,
        apiError?.message
      );
      const id =
        url
          .replace(/^https?:\/\//, "")
          .replace(/[^a-zA-Z0-9]/g, "-")
          .slice(0, 40) +
        "-" +
        Math.random().toString(36).slice(2, 6);
      downloadSource = {
        id,
        name: url.replace(/^https?:\/\//, "").split("/")[0],
        url,
        status: "active",
        downloadCount: 0,
        fingerprint: undefined,
      } as DownloadSource;
    }

    if (HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription()) {
      try {
        await HydraApi.post("/profile/download-sources", {
          urls: [url],
        });
      } catch (error) {
        logger.error("Failed to add download source to profile:", error);
      }
    }

    await downloadSourcesSublevel.put(downloadSource.id, {
      ...downloadSource,
      isRemote: true,
      createdAt: new Date().toISOString(),
    });

    return downloadSource;
  } catch (error) {
    logger.error("Failed to add download source:", error);
    throw error;
  }
};

registerEvent("addDownloadSource", addDownloadSource);
