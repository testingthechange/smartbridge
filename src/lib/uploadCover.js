// src/lib/uploadCover.js

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://album-backend-c7ed.onrender.com";

/**
 * Upload album cover image to S3 via backend
 * Returns: { s3Key }
 */
export async function uploadCover({ projectId, file }) {
  if (!projectId) throw new Error("Missing projectId");
  if (!file) throw new Error("Missing file");

  // convert to base64 (same pattern as mp3 upload)
  const base64 = await fileToBase64(file);

  const res = await fetch(`${API_BASE}/api/upload-cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      fileName: file.name,
      base64,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Cover upload failed");
  }

  return res.json(); // { ok, s3Key }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || "");
      // strip data:image/...;base64,
      resolve(out.replace(/^data:image\/\w+;base64,/, ""));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
