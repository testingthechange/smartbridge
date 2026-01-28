// FILE: src/minisite/catalog/catalogCore.js
// Core helpers + API calls + snapshot builder for Catalog.
//
// Phase 1 rule (critical):
// - DO NOT persist playbackUrl into snapshots / local project storage.
// - Persist only stable references (s3Key, fileName).
// - Playback URLs must be resolved at runtime (e.g., via /api/playback-url?s3Key=...).

export const DEFAULT_API_BASE = String(import.meta?.env?.VITE_API_BASE || "")
  .trim()
  .replace(/\/+$/, "");

if (!DEFAULT_API_BASE) {
  throw new Error("Missing VITE_API_BASE (e.g. https://album-backend-kmuo.onrender.com)");
}

export const MASTER_SAVE_ENDPOINT = `${DEFAULT_API_BASE}/api/master-save`;
export const MAX_UPLOAD_MB = 25;

export const VERSION_KEYS = [
  { key: "album", label: "Album Version" },
  { key: "a", label: "A Version" },
  { key: "b", label: "B Version" },
];

/* ---------------- storage helpers ---------------- */

export function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function projectKey(id) {
  return `project_${id}`;
}

export function loadProject(id) {
  if (!id) return null;
  const raw = localStorage.getItem(projectKey(id));
  return raw ? safeParse(raw) : null;
}

export function saveProject(id, obj) {
  if (!id) return;
  localStorage.setItem(projectKey(id), JSON.stringify(obj || {}));
}

/**
 * NOTE:
 * playbackUrl exists only for runtime/UI convenience.
 * It is intentionally NOT persisted into snapshots.
 */
export function emptySong(slot) {
  return {
    slot,
    title: "",
    titleJson: {
      slot,
      title: "",
      updatedAt: "",
      source: "catalog",
    },
    files: {
      album: { fileName: "", s3Key: "", playbackUrl: "" },
      a: { fileName: "", s3Key: "", playbackUrl: "" },
      b: { fileName: "", s3Key: "", playbackUrl: "" },
    },
  };
}

export function ensureSongTitleJson(slot, title) {
  const now = new Date().toISOString();
  return {
    slot: Number(slot),
    title: String(title || ""),
    updatedAt: now,
    source: "catalog",
  };
}

/* ---------------- misc utils ---------------- */

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function once(el, eventName) {
  return new Promise((resolve) => {
    const fn = () => {
      el.removeEventListener(eventName, fn);
      resolve();
    };
    el.addEventListener(eventName, fn);
  });
}

/* ---------------- Upload (STATIC SITE: DISABLED) ---------------- */

function safeFileName(name) {
  const raw = String(name || "file");
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function makeUploadKey({ projectId, slot, versionKey, fileName }) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const clean = safeFileName(fileName);
  return `storage/projects/${projectId}/catalog/uploads/song_${slot}/${versionKey}/${ts}__${clean}`;
}

// keep for parity (not used in static-site mode)
void makeUploadKey;

/**
 * Uploads a file via backend:
 * POST /api/upload-to-s3?projectId=...
 *
 * IMPORTANT:
 * smartbridge2 is a STATIC SITE. It must NOT call /api/upload-to-s3.
 * Uploading is out-of-scope in this deployment and belongs to the publisher/admin backend.
 */
export async function uploadSongFile() {
  throw new Error("upload-to-s3 disabled on smartbridge2 (static site). Upload in publisher/admin backend.");
}

/* ---------------- Playback URL ---------------- */

/**
 * Resolve a playable URL at runtime from a stable s3Key.
 * Backend MUST return a fresh playable url, not a stale persisted one.
 */
export async function fetchPlaybackUrl({ apiBase = DEFAULT_API_BASE, s3Key }) {
  const base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
  const key = String(s3Key || "").trim();
  if (!key) throw new Error("fetchPlaybackUrl: missing s3Key");

  const res = await fetch(`${base}/api/playback-url?s3Key=${encodeURIComponent(key)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok !== true) throw new Error(json?.error || `URL failed (${res.status})`);
  return json?.url || "";
}

/* ---------------- Snapshot / Master Save ---------------- */

export function buildLockedCatalog(project) {
  const songs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const lockedSongs = songs.map((s) => ({
    songNumber: Number(s?.slot),
    title: String((s?.title || "").trim()),
    titleJson: s?.titleJson || ensureSongTitleJson(s?.slot, s?.title || ""),
    versions: {
      A: {
        fileName: s?.files?.a?.fileName || "",
        s3Key: s?.files?.a?.s3Key || "",
        durationSec: null,
      },
      B: {
        fileName: s?.files?.b?.fileName || "",
        s3Key: s?.files?.b?.s3Key || "",
        durationSec: null,
      },
    },
    notes: "",
  }));

  return { songCount: lockedSongs.length, songs: lockedSongs };
}

/**
 * Normalize Catalog songs for snapshot storage.
 * CRITICAL: playbackUrl is always blanked to prevent persisting expiring signed URLs.
 */
function normalizeCatalogSongsForProject(project) {
  const songs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  return songs.map((s) => {
    const slot = Number(s?.slot);
    const title = String((s?.title || "").trim());

    const titleJson =
      s?.titleJson && typeof s.titleJson === "object"
        ? {
            slot: Number(s.titleJson.slot ?? slot),
            title: String(s.titleJson.title ?? title),
            updatedAt: String(s.titleJson.updatedAt || ""),
            source: String(s.titleJson.source || "catalog"),
          }
        : ensureSongTitleJson(slot, title);

    const files = s?.files && typeof s.files === "object" ? s.files : {};

    return {
      slot,
      title,
      titleJson,
      files: {
        album: {
          fileName: String(files?.album?.fileName || ""),
          s3Key: String(files?.album?.s3Key || ""),
          playbackUrl: "", // do not persist
        },
        a: {
          fileName: String(files?.a?.fileName || ""),
          s3Key: String(files?.a?.s3Key || ""),
          playbackUrl: "", // do not persist
        },
        b: {
          fileName: String(files?.b?.fileName || ""),
          s3Key: String(files?.b?.s3Key || ""),
          playbackUrl: "", // do not persist
        },
      },
    };
  });
}

function deriveAlbumSongTitlesFromCatalogSongs(catalogSongs) {
  return catalogSongs.map((s) => ({
    slot: Number(s.slot),
    title: String((s.title || "").trim()),
    titleJson: s.titleJson || ensureSongTitleJson(s.slot, s.title || ""),
  }));
}

export function buildSnapshot({ projectId, project }) {
  const now = new Date().toISOString();
  const pid = String(projectId || "").trim();
  const catalogSongs = normalizeCatalogSongsForProject(project);

  return {
    projectId: pid,
    createdAt: project?.createdAt || now,
    updatedAt: now,

    locked: {
      catalog: buildLockedCatalog(project),
    },

    project: {
      ...(project || {}),
      projectId: pid,
      catalog: {
        ...(project?.catalog || {}),
        songs: catalogSongs,
      },
      album: {
        ...(project?.album || {}),
        songTitles:
          Array.isArray(project?.album?.songTitles) && project.album.songTitles.length
            ? project.album.songTitles
            : deriveAlbumSongTitlesFromCatalogSongs(catalogSongs),
      },
      nftMix: project?.nftMix || {},
      songs: project?.songs || {},
      meta: project?.meta || {},
      masterSave: {
        ...(project?.masterSave || {}),
        lastMasterSaveAt: now,
        sections: {
          ...(project?.masterSave?.sections || {}),
          catalog: { complete: true, masterSavedAt: now },
        },
      },
    },
  };
}

export function projectForBackendFromSnapshot(snapshot) {
  return snapshot?.project || {};
}

export async function postMasterSave({ apiBase = DEFAULT_API_BASE, projectId, projectForBackend }) {
  const base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");

  const res = await fetch(`${base}/api/master-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      project: projectForBackend,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok !== true) throw new Error(json?.error || `Master Save failed (${res.status})`);
  return json;
}
