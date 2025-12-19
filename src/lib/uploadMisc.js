// src/lib/uploadMisc.js

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://album-backend-c7ed.onrender.com";

/**
 * Upload a misc file (images/videos/docs) to S3 via backend
 * Returns: { ok, s3Key }
 */
export async function uploadMisc({ projectId, file }) {
  if (!projectId) throw new Error("Missing projectId");
  if (!file) throw new Error("Missing file");

  const base64 = await fileToBase64Any(file);

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Misc upload failed");
  }

  return res.json();
}

function fileToBase64Any(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || "");
      resolve(out.replace(/^data:.*;base64,/, ""));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

