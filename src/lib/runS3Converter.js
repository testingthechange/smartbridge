export async function runS3Converter({ projectId, snapshotKey }) {
  if (!projectId || !snapshotKey) {
    throw new Error("Missing projectId or snapshotKey");
  }

  const res = await fetch("/api/convert-s3", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, snapshotKey }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Converter failed (${res.status})`);
  }

  return data;
}
