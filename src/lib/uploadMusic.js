// src/lib/uploadMisc.js
import { API_BASE } from "./apiBase.js";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

// Upload any file to /api/upload-misc
export async function uploadMisc({ projectId, file }) {
  if (!projectId) throw new Error("Missing projectId");
  if (!file) throw new Error("Missing file");

  const base64 = await fileToBase64(file);

  const res = await fetch(`${API_BASE}/api/upload-misc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      fileName: file.name,
      mimeType: file.type || "",
      base64,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) throw new Error(json?.error || text || `Upload failed (${res.status})`);
  return json; // { ok, s3Key, ... }
}
