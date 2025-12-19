// src/lib/masterSaveMiniSite.js

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://album-backend-c7ed.onrender.com";

/**
 * Create a Master Save payload from the current mini-site state
 * and POST it to the backend (/api/master-save), which writes to S3.
 *
 * IMPORTANT:
 * - MP3 keys are sourced from tracks[].mp3 (Album upload writes them there)
 * - We mirror them into masterSave.audio.mp3 so Export/Tools can auto-load
 */
export async function masterSaveMiniSite({
  projectId,
  tracks = [],
  sections = {},
  // Optional per-page blobs if you have them; we pass through if provided
  catalog = null,
  album = null,
  nftMix = null,
  songs = null,
  meta = null,
} = {}) {
  if (!projectId) {
    throw new Error("masterSaveMiniSite: missing projectId");
  }

  // Use a filename-safe timestamp id (matches the style you already saw)
  // Example: 2025-12-16T19-40-03-881Z
  const masterSaveId = new Date().toISOString().replace(/[:.]/g, "-");

  // Build catalog tracks minimally (trackId + title), stable
  const catalogTracks = (tracks || []).map((t) => ({
    trackId: String(t?.trackId || ""),
    title: String(t?.title || ""),
  }));

  // Build audio.mp3 from tracks[].mp3 written during Album upload
  const mp3List = (tracks || [])
    .filter((t) => t?.mp3?.s3Key)
    .map((t) => ({
      trackId: String(t.trackId),
      fileName: t.mp3?.fileName || "",
      s3Key: String(t.mp3.s3Key),
      etag: t.mp3?.etag ?? null,
      uploadedAt: t.mp3?.uploadedAt ?? null,
    }));

  // Sections: keep what you already track, but mark updatedAt on Master Save
  const savedAt = new Date().toISOString();
  const mergedSections = {
    catalog: { status: sections?.catalog?.status || "draft", ...sections?.catalog },
    album: { status: sections?.album?.status || "draft", ...sections?.album },
    nftMix: { status: sections?.nftMix?.status || "draft", ...sections?.nftMix },
    songs: { status: sections?.songs?.status || "draft", ...sections?.songs },
    meta: { status: sections?.meta?.status || "draft", ...sections?.meta },
  };

  // Construct masterSave object (this is what gets written into S3)
  const masterSave = {
    projectId: String(projectId),
    masterSaveId,
    savedAt,
    sections: mergedSections,

    // keep stable catalog + audio surface area for export/converter
    catalog: catalog ?? { tracks: catalogTracks },
    audio: { mp3: mp3List },

    // optional blobs (pass-through if you have them)
    ...(album ? { album } : {}),
    ...(nftMix ? { nftMix } : {}),
    ...(songs ? { songs } : {}),
    ...(meta ? { meta } : {}),
  };

  const res = await fetch(`${API_BASE}/api/master-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: String(projectId),
      masterSaveId,
      masterSave,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Master Save failed (HTTP ${res.status})`);
  }

  // Backend returns { s3Key } on success
  return {
    masterSaveId,
    masterSave,
    s3Key: json?.s3Key || null,
  };
}
