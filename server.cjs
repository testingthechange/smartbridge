// server.cjs
// Smart Bridge combined server: API (/api/*) + SPA (dist) on the same Render service.

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// S3-compatible JSON + file helpers (works for AWS S3 / R2 if env/creds set)
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "25mb" }));

// ---------- S3/R2 ----------
const AWS_REGION = process.env.AWS_REGION || "us-west-1";
const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "";
const SIGNED_URL_EXPIRES_SECONDS = Number(process.env.SIGNED_URL_EXPIRES_SECONDS || 1200);

const s3 = new S3Client({ region: AWS_REGION });

function must(v, msg) {
  if (!v) throw new Error(msg);
  return v;
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const c of readable) chunks.push(c);
  return Buffer.concat(chunks);
}

async function putJson(key, obj) {
  const bucket = must(S3_BUCKET, "Missing env S3_BUCKET (or AWS_S3_BUCKET)");
  const Body = Buffer.from(JSON.stringify(obj, null, 2));
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body,
      ContentType: "application/json",
    })
  );
  return { bucket, key };
}

async function getJson(key) {
  const bucket = must(S3_BUCKET, "Missing env S3_BUCKET (or AWS_S3_BUCKET)");
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = await streamToBuffer(out.Body);
  return JSON.parse(buf.toString("utf8"));
}

async function saveFileToR2({ key, contentType, body }) {
  // name kept for compatibility; works on S3/R2
  const bucket = must(S3_BUCKET, "Missing env S3_BUCKET (or AWS_S3_BUCKET)");
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );

  // Signed URL for playback/download
  const signed = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: SIGNED_URL_EXPIRES_SECONDS }
  );

  return signed;
}

// ---------- DATABASE ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render Postgres URLs typically require SSL
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
  } catch (err) {
    console.error("health error:", err);
    res.status(500).json({ ok: false, error: "DB_UNHEALTHY" });
  }
});

// ---------- upload-to-s3 (compat stub) ----------
app.post("/api/upload-to-s3", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: "MISSING_PROJECT_ID" });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const s3Key = `projects/${projectId}/uploads/${ts}`;

    return res.json({ ok: true, projectId, s3Key });
  } catch (err) {
    console.error("upload-to-s3 error:", err);
    return res.status(500).json({ ok: false, error: "UPLOAD_TO_S3_FAILED" });
  }
});

// ---------- PROJECT META (optional legacy table) ----------
app.post("/api/projects/:projectId/meta", async (req, res) => {
  const { projectId } = req.params;
  const meta = req.body;

  if (!meta || typeof meta !== "object") {
    return res.status(400).json({ ok: false, error: "NO_META_PAYLOAD" });
  }

  try {
    await pool.query(
      `
      INSERT INTO project_meta (project_id, meta_json)
      VALUES ($1, $2)
      ON CONFLICT (project_id)
      DO UPDATE SET
        meta_json = EXCLUDED.meta_json,
        updated_at = now()
      `,
      [projectId, meta]
    );

    res.json({ ok: true, projectId });
  } catch (err) {
    console.error("Error saving meta", err);
    res.status(500).json({ ok: false, error: "META_SAVE_FAILED" });
  }
});

app.get("/api/projects/:projectId/meta", async (req, res) => {
  const { projectId } = req.params;

  try {
    const result = await pool.query(`SELECT meta_json FROM project_meta WHERE project_id = $1`, [projectId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, meta: null });
    }

    res.json({ ok: true, meta: result.rows[0].meta_json });
  } catch (err) {
    console.error("Error loading meta", err);
    res.status(500).json({ ok: false, error: "META_LOAD_FAILED" });
  }
});

// ---------- MP3 UPLOAD ----------
app.post("/api/projects/:projectId/songs/:songId/upload", upload.single("file"), async (req, res) => {
  const { projectId, songId } = req.params;

  if (!req.file) {
    return res.status(400).json({ ok: false, error: "NO_FILE" });
  }

  const key = `projects/${projectId}/songs/${songId}/${req.file.originalname}`;

  try {
    const url = await saveFileToR2({
      key,
      contentType: req.file.mimetype,
      body: req.file.buffer,
    });

    res.json({ ok: true, url });
  } catch (err) {
    console.error("upload failed", err);
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

    await putJson(snapshotKey, {
      projectId,
      createdAt: now,
      source: "minisite-master-save",
      project,
    });

    await putJson(latestKey, {
      projectId,
      latestSnapshotKey: snapshotKey,
      lastMasterSaveAt: now,
    });

    res.json({ ok: true, snapshotKey, latestKey });
  } catch (err) {
    console.error("master-save error:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- MASTER SAVE LATEST ----------
app.get("/api/master-save/latest/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const latestKey = `storage/projects/${projectId}/producer_returns/latest.json`;

    const latest = await getJson(latestKey);
    const snapKey = String(latest?.latestSnapshotKey || "").trim() || String(latest?.snapshotKey || "").trim();

    if (!snapKey) {
      return res.status(404).json({ ok: false, error: "NO_LATEST_SNAPSHOT_KEY", latestKey });
    }

    const snapshot = await getJson(snapKey);

    const project = snapshot?.project || snapshot?.data || snapshot?.project?.data || null;
    const savedAt = snapshot?.createdAt || latest?.lastMasterSaveAt || null;

    res.json({
      ok: true,
      latestKey,
      latest,
      snapshot: {
        savedAt,
        project,
        raw: snapshot,
      },
    });
  } catch (err) {
    console.error("master-save latest error:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

/* ------------------------------ Public Manifest (PUBLIC_BUNDLE_V1) ------------------------------ */
function safeString(v) {
  return String(v ?? "").trim();
}

function makePublicManifest({ shareId, projectId, publishedAt, bundle, lineage }) {
  return {
    version: "PUBLIC_BUNDLE_V1",
    shareId: safeString(shareId),
    projectId: safeString(projectId),
    publishedAt: safeString(publishedAt),
    bundle: bundle && typeof bundle === "object" ? bundle : {},
    lineage: lineage && typeof lineage === "object" ? lineage : {},
  };
}

app.get("/api/public/manifest/:shareId", async (req, res) => {
  try {
    const shareId = String(req.params?.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, error: "missing_shareId" });

    const indexKey = `storage/public/manifests/${shareId}.json`;
    const index = await getJson(indexKey);

    if (!index || typeof index !== "object") {
      return res.status(404).json({ ok: false, error: "share_not_found", shareId });
    }

    const projectId = String(index.projectId || "").trim() || null;
    const publishedAt = String(index.publishedAt || index.createdAt || index.updatedAt || "").trim() || null;

    let snapshotKey = String(index.snapshotKey || index.latestSnapshotKey || "").trim();
    let latestKey = String(index.latestKey || "").trim();

    if (!snapshotKey && latestKey) {
      const latest = await getJson(latestKey);
      snapshotKey = String(latest?.latestSnapshotKey || latest?.snapshotKey || "").trim();
    }

    if (!snapshotKey && projectId) {
      latestKey = latestKey || `storage/projects/${projectId}/producer_returns/latest.json`;
      const latest = await getJson(latestKey);
      snapshotKey = String(latest?.latestSnapshotKey || latest?.snapshotKey || "").trim();
    }

    if (!snapshotKey) {
      return res.status(404).json({ ok: false, error: "no_snapshot_for_share", shareId, indexKey });
    }

    const snapshot = await getJson(snapshotKey);
    const bundle = snapshot?.project || snapshot?.data || snapshot?.project?.data || snapshot?.bundle || {};

    const manifest = makePublicManifest({
      shareId,
      projectId,
      publishedAt,
      bundle,
      lineage: {
        indexKey,
        latestKey: latestKey || null,
        snapshotKey,
        sourceSavedAt: snapshot?.createdAt || index?.savedAt || null,
      },
    });

    return res.json({ ok: true, manifest });
  } catch (err) {
    console.error("public manifest error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- PUBLISH (stub) ----------
app.post("/api/publish-minisite", (req, res) => {
  const { projectId, snapshotKey } = req.body || {};
  if (!projectId || !snapshotKey) {
    return res.status(400).json({ ok: false, error: "MISSING_PROJECTID_OR_SNAPSHOTKEY" });
  }

  return res.json({ ok: true, projectId, snapshotKey, note: "publish-minisite reached" });
});

// ---------- STATIC FRONTEND (SPA) ----------
const distDir = path.join(__dirname, "dist");

app.use(
  express.static(distDir, {
    etag: true,
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// SPA fallback (must be LAST)
// IMPORTANT: use /.*/ instead of "*" to avoid path-to-regexp crash in newer router stacks
app.get(/.*/, (req, res) => {
  // If an /api route is missing, return JSON 404 instead of index.html
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "NO_ROUTE" });
  }
  return res.sendFile(path.join(distDir, "index.html"));
});

// ---------- START ----------
app.listen(port, () => {
  console.log(`smartbridge server listening on port ${port}`);
});
