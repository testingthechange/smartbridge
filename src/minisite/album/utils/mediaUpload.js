// src/minisite/album/utils/mediaUpload.js

export function sanitizeFileName(name) {
  const s = String(name || "file").trim();
  return s
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 140);
}

export async function uploadToS3(API_BASE, file, s3Key) {
  const form = new FormData();
  form.append("file", file);
  form.append("s3Key", s3Key);

  const r = await fetch(`${API_BASE}/api/upload-to-s3`, {
    method: "POST",
    body: form,
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  if (!j?.ok) throw new Error(j?.error || "Upload failed");
  return { ok: true, s3Key: j.s3Key || s3Key, publicUrl: j.publicUrl || "" };
}
