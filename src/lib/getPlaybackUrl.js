// src/lib/getPlaybackUrl.js
const API_BASE =
  import.meta.env.VITE_API_BASE || "https://album-backend-c7ed.onrender.com";

export async function getPlaybackUrl(s3Key) {
  const res = await fetch(
    `${API_BASE}/api/playback-url?s3Key=${encodeURIComponent(s3Key)}`
  );

  const text = await res.text();
  if (!res.ok) throw new Error(text || `Playback URL failed (${res.status})`);

  const data = JSON.parse(text);
  if (!data?.ok || !data?.url) throw new Error("Playback URL missing");
  return data.url;
}
