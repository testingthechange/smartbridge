// src/lib/uploadSlideshow.js

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://album-backend-c7ed.onrender.com";

/**
 * Upload slideshow file to S3 via backend
 * Returns: { ok, s3Key }
 *
 * Accepts: PDF, images, ppt/pptx, zip (whatever your backend allows).
 * This mirrors uploadCover.js exactly, but:
 * - strips base64 prefix generically (any mime)
 * - sends to /api/upload-slideshow (add this endpoint on backend)
 */
export async function uploadSlideshow({ projectId, file }) {
  if (!projectId) throw new Error("Missing projectId");
  if (!file) throw new Error("Missing file");

  const base64 = await fileToBase64Any(file);

  const res = await fetch(`${API_BASE}/api/upload-slideshow`, {
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
    throw new Error(text || "Slideshow upload failed");
  }

  return res.json(); // { ok, s3Key }
}

// Generic base64 stripper: removes "data:*;base64," for ANY file type
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
