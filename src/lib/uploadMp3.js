// src/lib/uploadMp3.js
const API_BASE =
  import.meta.env.VITE_API_BASE || "https://album-backend-c7ed.onrender.com";

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("File read failed"));
    r.onload = () => resolve(String(r.result || ""));
    r.readAsDataURL(file);
  });
}

export async function uploadMp3({ projectId, trackId, file }) {
  if (!file) throw new Error("Missing file");

  const dataUrl = await readFileAsBase64(file);
  const base64 = dataUrl.replace(/^data:audio\/\w+;base64,/, "");

  const res = await fetch(`${API_BASE}/api/upload-mp3`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      trackId,
      base64,
      fileName: file.name,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text || `Upload failed (${res.status})`);

  const out = JSON.parse(text);
  if (!out?.ok || !out?.s3Key) throw new Error("Upload response missing s3Key");
  return out; // { ok, s3Key, etag, fileName, uploadedAt }
}
