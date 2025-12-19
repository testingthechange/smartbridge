import { randomUUID } from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type Mp3Ref = { trackId: string; s3Key: string; etag?: string | null; fileName?: string | null };
type MasterSave = {
  projectId: string;
  masterSaveId: string;
  savedAt?: string;
  catalog?: { tracks?: { trackId: string; title?: string }[] };
  audio?: { mp3?: Mp3Ref[] };
};

function pushPackageKey(projectId: string, runId: string) {
  return `storage/projects/${projectId}/exports/s3_converter/${runId}/push_package.json`;
}

async function getJson<T>(s3: S3Client, bucket: string, key: string): Promise<T> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const c of res.Body as any) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}

export async function buildPushPackage(opts: {
  s3: S3Client;
  bucket: string;
  projectId: string;
  masterSaveKey: string;
}) {
  const { s3, bucket, projectId, masterSaveKey } = opts;

  const masterSave = await getJson<MasterSave>(s3, bucket, masterSaveKey);
  const runId = randomUUID();

  const tracks = masterSave.catalog?.tracks ?? [];
  const mp3s = masterSave.audio?.mp3 ?? [];
  const titleById = new Map(tracks.map(t => [t.trackId, t.title ?? ""]));

  const pushPackage = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    projectId,
    source: { masterSaveKey },
    tracks: mp3s.map(m => ({
      trackId: m.trackId,
      title: titleById.get(m.trackId) ?? "",
      mp3: { s3Key: m.s3Key, etag: m.etag ?? null, fileName: m.fileName ?? null }
    })),
  };

  const outKey = pushPackageKey(projectId, runId);

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: outKey,
    Body: Buffer.from(JSON.stringify(pushPackage, null, 2), "utf-8"),
    ContentType: "application/json",
    ServerSideEncryption: "AES256",
  }));

  return { runId, pushPackageKey: outKey, trackCount: pushPackage.tracks.length };
}

