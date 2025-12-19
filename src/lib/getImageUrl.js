// src/lib/getImageUrl.js
export async function getImageUrl(s3Key) {
  const r = await fetch(`/api/storage/view-url?key=${encodeURIComponent(s3Key)}`, {
    credentials: "include",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Could not fetch image URL");
  return j.url;
}
