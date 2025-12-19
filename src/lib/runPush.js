export async function uploadMp3({ projectId, trackId, file }) {
  const fd = new FormData();
  fd.append("projectId", projectId);
  fd.append("trackId", trackId);
  fd.append("file", file);

  const res = await fetch("/api/upload-mp3", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "MP3 upload failed");
  }

  return res.json(); // { s3Key, etag }
}
