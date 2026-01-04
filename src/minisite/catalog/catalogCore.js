// src/minisite/catalog/catalogCore.js
// Core helpers + API calls + snapshot builder for Catalog.

export const DEFAULT_API_BASE =
  (import.meta?.env?.VITE_BACKEND_URL || "").trim() ||
  "https://album-backend-c7ed.onrender.com";

export const MASTER_SAVE_ENDPOINT = `${DEFAULT_API_BASE}/api/master-save`;
export const MAX_UPLOAD_MB = 25;

export const VERSION_KEYS = [
  { key: "album", label: "Album Version" },
  { key: "a", label: "A Version" },
  { key: "b", label: "B Version" },
];

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
  localStorage.setItem(projectKey(id), JSON.stringify(obj));
}

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

/* ---------------- Upload (use /api/upload-to-s3) ---------------- */

function safeFileName(name) {
  const raw = String(name || "file");
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function makeUploadKey({ projectId, slot, versionKey, fileName }) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const clean = safeFileName(fileName);
  return `storage/projects/${projectId}/catalog/uploads/song_${slot}/${versionKey}/${ts}__${clean}`;
}

/**
 * Uploads a file via backend:
 * POST /api/upload-to-s3 (multipart: file, s3Key)
 * Returns: { ok:true, s3Key, publicUrl }
 */
export async function uploadSongFile({
  apiBase = DEFAULT_API_BASE,
  projectId,
  slot,
  versionKey,
  file,
}) {
  const s3Key = makeUploadKey({
    projectId,
    slot,
    versionKey,
    fileName: file?.name || "audio",
  });

  const fd = new FormData();
  fd.append("file", file);
  fd.append("s3Key", s3Key);

  // ✅ ONE-LINE FIX: always include projectId so backend never has to guess it
  const res = await fetch(
    `${apiBase}/api/upload-to-s3?projectId=${encodeURIComponent(String(projectId || ""))}`,
    {
      method: "POST",
      body: fd,
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Upload failed (${res.status})`);

  return json; // { ok, s3Key, publicUrl }
}

/* ---------------- Playback URL ---------------- */

export async function fetchPlaybackUrl({ apiBase = DEFAULT_API_BASE, s3Key }) {
  const res = await fetch(
    `${apiBase}/api/playback-url?s3Key=${encodeURIComponent(String(s3Key || ""))}`
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `URL failed (${res.status})`);
  return json?.url || "";
}

/* ---------------- Snapshot / Master Save ---------------- */

// ✅ This is the human-facing Catalog lock object (fine to keep)
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

// ✅ THIS is what publish expects: snapshot.project.catalog.songs with slot/title/files.*
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
          playbackUrl: String(files?.album?.playbackUrl || ""),
        },
        a: {
          fileName: String(files?.a?.fileName || ""),
          s3Key: String(files?.a?.s3Key || ""),
          playbackUrl: String(files?.a?.playbackUrl || ""),
        },
        b: {
          fileName: String(files?.b?.fileName || ""),
          s3Key: String(files?.b?.s3Key || ""),
          playbackUrl: String(files?.b?.playbackbackUrl || ""),
        },
      },
    };
  });
}

// ✅ Make sure album.songTitles exists too (optional but useful)
function deriveAlbumSongTitlesFromCatalogSongs(catalogSongs) {
  return catalogSongs.map((s) => ({
    slot: Number(s.slot),
    title: String((s.title || "").trim()),
    titleJson: s.titleJson || ensureSongTitleJson(s.slot, s.title || ""),
  }));
}

export function buildSnapshot({ projectId, project }) {
  const now = new Date().toISOString();
  const catalogSongs = normalizeCatalogSongsForProject(project);

  return {
    projectId,
    createdAt: project?.createdAt || now,
    updatedAt: now,

    // keep the “locked” object for historical/reporting if you want
    locked: {
      catalog: buildLockedCatalog(project),
    },

    // ✅ publish-minisite reads from snapshot.project.catalog.songs / album
    project: {
      ...(project || {}),
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

// ✅ Backend wants just the project object
export function projectForBackendFromSnapshot(snapshot) {
  return snapshot?.project || {};
}

export async function postMasterSave({
  apiBase = DEFAULT_API_BASE,
  projectId,
  projectForBackend,
}) {
  const res = await fetch(`${apiBase}/api/master-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      project: projectForBackend,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Master Save failed (${res.status})`);
  return json; // { ok:true, snapshotKey, version? }
}
