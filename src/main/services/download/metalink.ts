/**
 * Gamify Tier D: Metalink generation for aria2 multi-source per-chunk combining.
 * When same repack file is mirrored on 2+ hosts with identical size/hash,
 * generate Metalink XML with multiple <url> entries so aria2 --metalink can pull chunks from all hosts.
 * For now stub generates XML and falls back to raceMirrors if aria2 not available.
 */
export interface MetalinkFile {
  name: string;
  size: number;
  urls: string[]; // direct resolved urls (fuckingfast dl, pixeldrain direct, etc.)
  hashes?: { type: "sha-256" | "sha-1" | "md5"; hash: string }[];
}

export function buildMetalinkXml(files: MetalinkFile[]): string {
  const fileEntries = files
    .map(
      (f) => `  <file name="${escapeXml(f.name)}">
    <size>${f.size}</size>
${f.hashes?.map((h) => `    <hash type="${h.type}">${h.hash}</hash>`).join("\n") ?? ""}
${f.urls.map((u) => `    <url>${escapeXml(u)}</url>`).join("\n")}
  </file>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<metalink version="3.0" xmlns="http://www.metalinker.org/">
  <files>
${fileEntries}
  </files>
</metalink>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
