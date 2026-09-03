import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, SelectField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { NetworkInterface, UserPreferences } from "@types";
import { SettingsGlobalTrackers } from "./settings-global-trackers";

import "./settings-general.scss";

const formatLimitInputValue = (
  value: number,
  useMegabytes: boolean
): string => {
  const unitValue = useMegabytes ? value / (1024 * 1024) : (value * 8) / 1e6;
  return Number.isInteger(unitValue)
    ? `${unitValue}`
    : `${Number(unitValue.toFixed(2))}`;
};

const buildForm = (preferences: UserPreferences | null) => ({
  seedAfterDownloadComplete: preferences?.seedAfterDownloadComplete ?? false,
  showDownloadSpeedInMegabytes:
    preferences?.showDownloadSpeedInMegabytes ?? false,
  extractFilesByDefault: preferences?.extractFilesByDefault ?? true,
  createStartMenuShortcut: preferences?.createStartMenuShortcut ?? true,
  maxDownloadSpeedMegabytes:
    typeof preferences?.maxDownloadSpeedBytesPerSecond === "number" &&
    preferences.maxDownloadSpeedBytesPerSecond > 0
      ? formatLimitInputValue(
          preferences.maxDownloadSpeedBytesPerSecond,
          preferences.showDownloadSpeedInMegabytes ?? false
        )
      : "",
  deleteArchiveFilesAfterExtractionByDefault:
    preferences?.deleteArchiveFilesAfterExtractionByDefault ?? false,
  torrentNetworkInterface: preferences?.torrentNetworkInterface ?? "",
  gamifyEnableParallelDownloads:
    preferences?.gamifyEnableParallelDownloads ?? true,
  gamifyMaxConnections: preferences?.gamifyMaxConnections ?? 16,
  gamifyMaxConcurrentFiles: preferences?.gamifyMaxConcurrentFiles ?? 3,
  gamifyAutoReResolve: preferences?.gamifyAutoReResolve ?? true,
});

export function SettingsContextDownloads() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const parseLimitInputToBytesPerSecond = (
    value: string,
    useMegabytes: boolean
  ): number | null | undefined => {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed)) return undefined;
    if (parsed <= 0) return null;

    return useMegabytes
      ? Math.floor(parsed * 1024 * 1024)
      : Math.floor((parsed * 1e6) / 8);
  };

  const [form, setForm] = useState(() => buildForm(userPreferences));

  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);

  useEffect(() => {
    globalThis.electron
      .getNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch(() => setNetworkInterfaces([]));
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const networkInterfaceOptions = useMemo(() => {
    const options = [
      { key: "default", value: "", label: t("network_interface_default") },
      ...networkInterfaces.map((networkInterface) => {
        const ipv4 = networkInterface.addresses.find(
          (address) => !address.includes(":")
        );

        return {
          key: networkInterface.name,
          value: networkInterface.name,
          label: ipv4
            ? `${networkInterface.name} (${ipv4})`
            : networkInterface.name,
        };
      }),
    ];

    const selected = form.torrentNetworkInterface;
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({
        key: selected,
        value: selected,
        label: `${selected} (${t("network_interface_unavailable")})`,
      });
    }

    return options;
  }, [networkInterfaces, form.torrentNetworkInterface, t]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleMaxDownloadSpeedBlur = () => {
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    if (parsedBytesPerSecond === undefined) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    if (parsedBytesPerSecond === null) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    const nextLimitValue = formatLimitInputValue(
      parsedBytesPerSecond,
      form.showDownloadSpeedInMegabytes
    );
    setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: nextLimitValue }));
    updateUserPreferences({
      maxDownloadSpeedBytesPerSecond: parsedBytesPerSecond,
    });
  };

  const handleSpeedUnitChange = () => {
    const nextUseMegabytes = !form.showDownloadSpeedInMegabytes;
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    const nextLimitInput =
      typeof parsedBytesPerSecond === "number" && parsedBytesPerSecond > 0
        ? formatLimitInputValue(parsedBytesPerSecond, nextUseMegabytes)
        : "";

    setForm((prev) => ({
      ...prev,
      showDownloadSpeedInMegabytes: nextUseMegabytes,
      maxDownloadSpeedMegabytes: nextLimitInput,
    }));

    updateUserPreferences({
      showDownloadSpeedInMegabytes: nextUseMegabytes,
    });
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("download_behavior")}</h3>

        <TextField
          type="number"
          min="0"
          step="0.1"
          label={t("max_download_speed", {
            unit: form.showDownloadSpeedInMegabytes ? "MB/s" : "Mbps",
          })}
          hint={t("max_download_speed_hint", {
            unit: form.showDownloadSpeedInMegabytes
              ? t("max_download_speed_unit_megabytes")
              : t("max_download_speed_unit_megabits"),
          })}
          value={form.maxDownloadSpeedMegabytes}
          onChange={(event) => {
            setForm((prev) => ({
              ...prev,
              maxDownloadSpeedMegabytes: event.target.value,
            }));
          }}
          onBlur={handleMaxDownloadSpeedBlur}
          placeholder={t("max_download_speed_unlimited")}
        />

        <div className="settings-general__network-interface">
          <SelectField
            label={t("network_interface")}
            value={form.torrentNetworkInterface}
            onChange={(event) =>
              handleChange({ torrentNetworkInterface: event.target.value })
            }
            options={networkInterfaceOptions}
          />
          <small className="settings-general__network-interface-hint">
            {t("network_interface_hint")}
          </small>
        </div>

        <CheckboxField
          label={t("seed_after_download_complete")}
          checked={form.seedAfterDownloadComplete}
          onChange={() =>
            handleChange({
              seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
            })
          }
        />

        <CheckboxField
          label={t("extract_files_by_default")}
          checked={form.extractFilesByDefault}
          onChange={() =>
            handleChange({
              extractFilesByDefault: !form.extractFilesByDefault,
            })
          }
        />

        <CheckboxField
          label={t("show_download_speed_in_megabytes")}
          checked={form.showDownloadSpeedInMegabytes}
          onChange={handleSpeedUnitChange}
        />

        <CheckboxField
          label={t("delete_archive_files_after_extraction")}
          checked={form.deleteArchiveFilesAfterExtractionByDefault}
          onChange={() =>
            handleChange({
              deleteArchiveFilesAfterExtractionByDefault:
                !form.deleteArchiveFilesAfterExtractionByDefault,
            })
          }
        />

        {(window.electron.platform === "win32" ||
          window.electron.platform === "linux") && (
          <CheckboxField
            label={t("create_shortcuts_on_download")}
            checked={form.createStartMenuShortcut}
            onChange={() =>
              handleChange({
                createStartMenuShortcut: !form.createStartMenuShortcut,
              })
            }
          />
        )}

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border-color)", paddingTop: 16 }}>
          <h4>{t("gamify_accelerated_downloads", "Gamify — Accelerated Downloads (Windows)")}</h4>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            {t(
              "gamify_desc",
              "Enable 16× Range parallel (Tier A) and multi-file concurrency. Verified via cs.rin.ru t=95461. Fallback is single-stream if server lacks Accept-Ranges."
            )}
          </p>
          <CheckboxField
            label={t("gamify_enable_parallel", "Enable 16× parallel downloads")}
            checked={form.gamifyEnableParallelDownloads}
            onChange={() =>
              handleChange({
                gamifyEnableParallelDownloads: !form.gamifyEnableParallelDownloads,
              })
            }
          />
          <TextField
            type="number"
            min="4"
            max="16"
            step="1"
            label={t("gamify_max_connections", "Max connections per file (4–16)")}
            value={String(form.gamifyMaxConnections)}
            disabled={!form.gamifyEnableParallelDownloads}
            onChange={(e) => {
              const v = Math.max(4, Math.min(16, parseInt(e.target.value, 10) || 16));
              handleChange({ gamifyMaxConnections: v });
            }}
          />
          <TextField
            type="number"
            min="1"
            max="8"
            step="1"
            label={t("gamify_max_concurrent_files", "Max concurrent files (1–8, repack parts)")}
            value={String(form.gamifyMaxConcurrentFiles)}
            onChange={(e) => {
              const v = Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 3));
              handleChange({ gamifyMaxConcurrentFiles: v });
            }}
          />
          <CheckboxField
            label={t("gamify_auto_reresolve", "Auto re-resolve stalled FuckingFast links")}
            checked={form.gamifyAutoReResolve}
            onChange={() =>
              handleChange({ gamifyAutoReResolve: !form.gamifyAutoReResolve })
            }
          />
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("global_trackers")}</h3>
        <SettingsGlobalTrackers />
      </div>
    </div>
  );
}
