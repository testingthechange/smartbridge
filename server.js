// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

// For JSON master-save storage
const { putJson, getJson } = require("./storage.js");

// AWS SDK
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- middleware ----------
app.use(cors());
app.use(express.json({ limit: process.env.JSON_LIMIT || "60mb" }));

// ---------- env / s3 ----------
const BUCKET = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const PUBLIC_BASE = (process.env.PUBLIC_PLAYERS_BASE_URL || "").trim();

if (!BUCKET) console.warn("WARN: Missing AWS_S3_BUCKET (or S3_BUCKET).");
if (!REGION) console.warn("WARN: Missing AWS_REGION (or AWS_DEFAULT_REGION).");
if (!PUBLIC_BASE) console.warn("WARN: Missing PUBLIC_PLAYERS_BASE_URL (publish will fail).");

const s3 = BUCKET && REGION ? new S3Client({ region: REGION }) : null;

// ---------- helpers ----------
function stripDataUrlPrefix(b64) {
  return String(b64 || "").replace(/^data:.*;base64,/, "");
}

function safeExtFromFileName(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase().replace(".", "");
  return ext || "bin";
}

function defaultMimeForExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "pdf") return "application/pdf";
  if (e === "mp3") return "audio/mpeg";
  if (e === "wav") return "audio/wav";
  if (e === "m4a") return "audio/mp4";
  if (e === "mp4") return "video/mp4";
  if (e === "mov") return "video/quicktime";
  if (e === "webm") return "video/webm";
  if (e === "ppt") return "application/vnd.ms-powerpoint";
  if (e === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (e === "zip") return "application/zip";
  if (e === "txt") return "text/plain";
  if (e === "doc") return "application/msword";
  if (e === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function makeKeySafeName(name) {
  return String(name || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

async function putBase64ObjectToS3({ key, base64, contentType }) {
  if (!s3) throw new Error("S3 not configured (missing BUCKET/REGION)");
  const cleaned = stripDataUrlPrefix(base64);
  if (!cleaned) throw new Error("Missing base64");
  const buf = Buffer.from(cleaned, "base64");

  const out = await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buf,
      ContentType: contentType || "application/octet-stream",
      CacheControl: "no-store, max-age=0",
      ServerSideEncryption: "AES256",
    })
  );

  return { etag: out.ETag || null };
}

// ---------- root ----------
app.get("/", (_req, res) => {
  res.send("album-backend root OK");
});

// ---------- health ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ deploy proof endpoint
app.get("/api/publish-proof", (_req, res) => {
  res.json({
    ok: true,
    proof: "publish-proof-v1",
    commit: process.env.RENDER_GIT_COMMIT || "unknown",
    deployedAt: process.env.RENDER_DEPLOYED_AT || "unknown",
  });
});

// ---------- version ----------
app.get("/api/version", (_req, res) => {
  res.json({
    ok: true,
    service: "album-backend",
    version: "master-save+upload+playback+publish-inline-v2",
    commit: process.env.RENDER_GIT_COMMIT || "unknown",
    deployedAt: process.env.RENDER_DEPLOYED_AT || "unknown",
  });
});

// =======================================================
// ✅ PUBLISH MINI SITE (WRITE TO PUBLIC S3)
// POST /api/publish-minisite
// body: { projectId, snapshotKey }
// =======================================================
app.post("/api/publish-minisite", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });
    if (!PUBLIC_BASE) return res.status(500).json({ ok: false, error: "Missing PUBLIC_PLAYERS_BASE_URL on Render" });

    const { projectId, snapshotKey } = req.body || {};
    if (!projectId || !snapshotKey) return res.status(400).json({ ok: false, error: "Missing projectId or snapshotKey" });

    const shareId = crypto.randomBytes(8).toString("hex");
    const baseKey = `public/players/${shareId}`;
    const manifestKey = `${baseKey}/manifest.json`;
    const indexKey = `${baseKey}/index.html`;

    const manifest = {
      ok: true,
      projectId,
      snapshotKey,
      shareId,
      publishedAt: new Date().toISOString(),
      version: 1,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: manifestKey,
        Body: Buffer.from(JSON.stringify(manifest, null, 2)),
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-store",
      })
    );

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Smart Bridge Minisite</title>
</head>
<body>
  <pre id="out">Loading manifest…</pre>
  <script>
    fetch("./manifest.json")
      .then(r => r.json())
      .then(m => { document.getElementById("out").textContent = JSON.stringify(m, null, 2); })
      .catch(err => { document.getElementById("out").textContent = String(err); });
  </script>
</body>
</html>`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: indexKey,
        Body: Buffer.from(html),
        ContentType: "text/html; charset=utf-8",
        CacheControl: "no-store",
      })
    );

    const publicUrl = `${PUBLIC_BASE}/${baseKey}/index.html`;
    return res.json({ ok: true, shareId, publicUrl, manifestKey });
  } catch (err) {
    console.error("PUBLISH ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// MASTER SAVE (WRITE)
// expects { projectId, project }
// =======================================================
app.post("/api/master-save", async (req, res) => {
  try {
    const { projectId, project } = req.body || {};
    if (!projectId || !project) return res.status(400).json({ ok: false, error: "Missing projectId or project" });

    const now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-");

    const basePath = `storage/projects/${projectId}/producer_returns`;
    const snapshotKey = `${basePath}/snapshots/${ts}.json`;
    const latestKey = `${basePath}/latest.json`;

    await putJson(snapshotKey, { projectId, savedAt: now, project });
    await putJson(latestKey, { projectId, latestSnapshotKey: snapshotKey, savedAt: now });

    return res.json({ ok: true, snapshotKey, latestKey });
  } catch (err) {
    console.error("MASTER SAVE ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// MASTER SAVE (READ BACK)
// =======================================================
app.get("/api/master-save/latest/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const latestKey = `storage/projects/${projectId}/producer_returns/latest.json`;

    const latest = await getJson(latestKey);
    const snapshot = await getJson(latest.latestSnapshotKey);

    return res.json({ ok: true, latestKey, latest, snapshot });
  } catch (err) {
    console.error("READBACK ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// UPLOAD MP3
// POST /api/upload-mp3  { projectId, trackId, base64, fileName? }
// =======================================================
app.post("/api/upload-mp3", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });

    const { projectId, trackId, base64, fileName } = req.body || {};
    if (!projectId || !trackId || !base64) return res.status(400).json({ ok: false, error: "Missing projectId, trackId, or base64" });

    const cleaned = String(base64).replace(/^data:audio\/\w+;base64,/, "");
    const buf = Buffer.from(cleaned, "base64");

    const key = `storage/projects/${projectId}/audio/mp3/${trackId}.mp3`;

    const out = await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: "audio/mpeg",
        CacheControl: "no-store, max-age=0",
        ServerSideEncryption: "AES256",
      })
    );

    return res.json({ ok: true, s3Key: key, etag: out.ETag || null, fileName: fileName || null, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("UPLOAD MP3 ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// ✅ UPLOAD COVER
// POST /api/upload-cover { projectId, fileName, base64, mimeType? }
// =======================================================
app.post("/api/upload-cover", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });

    const { projectId, fileName, base64, mimeType } = req.body || {};
    if (!projectId || !fileName || !base64) return res.status(400).json({ ok: false, error: "Missing projectId, fileName, or base64" });

    const ext = safeExtFromFileName(fileName);
    const ct = (mimeType || "").trim() || defaultMimeForExt(ext) || "application/octet-stream";
    const key = `storage/projects/${projectId}/album/cover/cover.${ext}`;

    const { etag } = await putBase64ObjectToS3({ key, base64, contentType: ct });
    return res.json({ ok: true, s3Key: key, etag, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("UPLOAD COVER ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// ✅ UPLOAD SLIDESHOW
// POST /api/upload-slideshow { projectId, fileName, base64, mimeType? }
// =======================================================
app.post("/api/upload-slideshow", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });

    const { projectId, fileName, base64, mimeType } = req.body || {};
    if (!projectId || !fileName || !base64) return res.status(400).json({ ok: false, error: "Missing projectId, fileName, or base64" });

    const ext = safeExtFromFileName(fileName);
    const ct = (mimeType || "").trim() || defaultMimeForExt(ext) || "application/octet-stream";
    const safeName = makeKeySafeName(fileName);
    const key = `storage/projects/${projectId}/album/slideshow/${safeName}`;

    const { etag } = await putBase64ObjectToS3({ key, base64, contentType: ct });
    return res.json({ ok: true, s3Key: key, etag, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("UPLOAD SLIDESHOW ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// ✅ UPLOAD MISC (THIS FIXES YOUR 404)
// POST /api/upload-misc { projectId, fileName, base64, mimeType? }
// =======================================================
app.post("/api/upload-misc", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });

    const { projectId, fileName, base64, mimeType } = req.body || {};
    if (!projectId || !fileName || !base64) return res.status(400).json({ ok: false, error: "Missing projectId, fileName, or base64" });

    const ext = safeExtFromFileName(fileName);
    const ct = (mimeType || "").trim() || defaultMimeForExt(ext) || "application/octet-stream";

    const safeName = makeKeySafeName(fileName);
    const nonce = crypto.randomBytes(6).toString("hex");
    const key = `storage/projects/${projectId}/catalog/uploads/${Date.now()}_${nonce}_${safeName}`;

    const { etag } = await putBase64ObjectToS3({ key, base64, contentType: ct });
    return res.json({ ok: true, s3Key: key, etag, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("UPLOAD MISC ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =======================================================
// PRESIGNED PLAYBACK/VIEW URL
// GET /api/playback-url?s3Key=...
// =======================================================
app.get("/api/playback-url", async (req, res) => {
  try {
    if (!s3) return res.status(500).json({ ok: false, error: "S3 not configured (missing BUCKET/REGION)" });

    const s3Key = String(req.query.s3Key || "").trim();
    if (!s3Key) return res.status(400).json({ ok: false, error: "Missing s3Key" });

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ResponseCacheControl: "no-store, max-age=0",
        ResponseExpires: new Date(0).toUTCString(),
      }),
      { expiresIn: 60 * 10 }
    );

    return res.json({ ok: true, url });
  } catch (err) {
    console.error("PLAYBACK URL ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- start ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
