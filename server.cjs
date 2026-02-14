// server.cjs
// Smart Bridge combined server: API (/api/*) + SPA (dist) on the same Render service.

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// S3-compatible JSON + file helpers
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const port = process.env.PORT || 3000;

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  "https://smartbridge2.onrender.com",
  "https://blackout-web.onrender.com",
  "http://localhost:5173",
  "http://localhost:4173",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`), false);
    },
  })
);

app.use(express.json({ limit: "25mb" }));

// ---------- S3 / LOCAL STORAGE ----------
const AWS_REGION = process.env.AWS_REGION || "us-west-1";
const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "";
const SIGNED_URL_EXPIRES_SECONDS = Number(process.env.SIGNED_URL_EXPIRES_SECONDS || 1200);

const s3 = new S3Client({ region: AWS_REGION });

// local fallback root
const DEV_DATA_DIR = path.join(process.cwd(), "dev-data");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function keyToLocalPath(key) {
  const safe = String(key || "").replace(/^\/+/, "");
  return path.join(DEV_DATA_DIR, safe);
}

function hasS3Creds() {
  if (!S3_BUCKET) return false;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return true;
  if (process.env.AWS_PROFILE) return true;
  if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) return true;
  if (process.env.AWS_WEB_IDENTITY_TOKEN_FILE) return true;
  return false;
}

function canUseS3() {
  return !!S3_BUCKET && hasS3Creds();
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(c);
  return Buffer.concat(chunks);
}

async function putJson(key, obj) {
  if (canUseS3()) {
    const Body = Buffer.from(JSON.stringify(obj, null, 2));
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body,
        ContentType: "application/json",
      })
    );
    return { backend: "s3", key };
  }

  ensureDir(DEV_DATA_DIR);
  const filePath = keyToLocalPath(key);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  return { backend: "fs", key };
}

async function getJson(key) {
  if (canUseS3()) {
    const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const buf = await streamToBuffer(out.Body);
    return JSON.parse(buf.toString("utf8"));
  }

  const filePath = keyToLocalPath(key);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function saveFileToR2({ key, contentType, body }) {
  if (canUseS3()) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      })
    );

    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: SIGNED_URL_EXPIRES_SECONDS }
    );
  }

  ensureDir(DEV_DATA_DIR);
  const filePath = keyToLocalPath(key);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, body);
  return `localfs://${key}`;
}

// ---------- DATABASE ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

// ---------- ROOT ----------
app.get("/", (_req, res) => {
  res.status(200).send("smartbridge server OK");
});

// ---------- PROBE ----------
app.get("/api/__routes_probe", (_req, res) => {
  res.json({ ok: true, service: "smartbridge", ts: new Date().toISOString() });
});

// ---------- HEALTH ----------
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "DB_UNHEALTHY" });
  }
});

// ---------- MP3 UPLOAD ----------
app.post("/api/projects/:projectId/songs/:songId/upload", upload.single("file"), async (req, res) => {
  const { projectId, songId } = req.params;
  if (!req.file) return res.status(400).json({ ok: false, error: "NO_FILE" });

  const key = `projects/${projectId}/songs/${songId}/${req.file.originalname}`;

  try {
    const url = await saveFileToR2({
      key,
      contentType: req.file.mimetype,
      body: req.file.buffer,
    });
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- MASTER SAVE ----------
app.post("/api/master-save", async (req, res) => {
  try {
    const { projectId, project } = req.body || {};
    if (!projectId || !project) {
      return res.status(400).json({ ok: false, error: "MISSING_PROJECTID_OR_PROJECT" });
    }

    const now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-");

    const snapshotKey = `storage/projects/${projectId}/producer_returns/snapshots/${ts}.json`;
    const latestKey = `storage/projects/${projectId}/producer_returns/latest.json`;

    await putJson(snapshotKey, { projectId, createdAt: now, project });
    await putJson(latestKey, { projectId, latestSnapshotKey: snapshotKey, lastMasterSaveAt: now });

    res.json({ ok: true, snapshotKey, latestKey });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- PUBLIC MANIFEST ----------
app.get("/api/public/manifest/:shareId", async (req, res) => {
  try {
    const shareId = String(req.params.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, error: "missing_shareId" });

    const indexKey = `storage/public/manifests/${shareId}.json`;
    const index = await getJson(indexKey);

    if (!index) {
      return res.status(404).json({ ok: false, error: "share_not_found", shareId });
    }

    const snapshotKey = index.snapshotKey;
    const snapshot = snapshotKey ? await getJson(snapshotKey) : null;

    if (!snapshot) {
      return res.status(404).json({ ok: false, error: "no_snapshot_for_share" });
    }

    return res.json({
      ok: true,
      manifest: {
        version: "PUBLIC_BUNDLE_V1",
        shareId,
        projectId: index.projectId || null,
        publishedAt: index.publishedAt || null,
        bundle: snapshot.project || {},
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- STATIC FRONTEND ----------
const distDir = path.join(__dirname, "dist");

app.use(express.static(distDir));

app.get(/.*/, (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "NO_ROUTE" });
  }
  return res.sendFile(path.join(distDir, "index.html"));
});

// ---------- START ----------
app.listen(port, () => {
  console.log(`smartbridge server listening on port ${port}`);
});
