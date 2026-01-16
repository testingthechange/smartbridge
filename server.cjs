// server.cjs
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// ✅ FIXED: explicitly require storage.cjs
const { saveFileToR2, putJson, getJson } = require("./storage.cjs");

const app = express();
const port = process.env.PORT || 3000;

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
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
  })
);

app.use(express.json());

// ---------- DATABASE ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------- ROOT ----------
app.get("/", (req, res) => {
  res.status(200).send("album-backend OK");
});

// ---------- PROBE: confirms deploy + routing ----------
app.get("/api/__routes_probe", (req, res) => {
  res.json({ ok: true, service: "album-backend", ts: new Date().toISOString() });
});

// ---------- HEALTH ----------
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// ---------------------------------------------------------------------
// ✅ ADD THIS: upload-to-s3 compatibility endpoint
// Returns { s3Key } so the frontend does not fail.
// This does NOT implement real upload. It only provides the contract.
// ---------------------------------------------------------------------
app.post("/api/upload-to-s3", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ ok: false, error: "MISSING_PROJECT_ID" });
    }

    // Minimal deterministic key. Frontend only needs a string.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const s3Key = `projects/${projectId}/uploads/${ts}`;

    return res.json({ ok: true, projectId, s3Key });
  } catch (err) {
    console.error("upload-to-s3 error:", err);
    return res.status(500).json({ ok: false, error: "UPLOAD_TO_S3_FAILED" });
  }
});

// ---------- META ----------
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
    const result = await pool.query(
      `SELECT meta_json FROM project_meta WHERE project_id = $1`,
      [projectId]
    );

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
app.post(
  "/api/projects/:projectId/songs/:songId/upload",
  upload.single("file"),
  async (req, res) => {
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
      console.error("R2 upload failed", err);
      res.status(500).json({ ok: false, error: "UPLOAD_FAILED" });
    }
  }
);

// ---------- MASTER SAVE ----------
app.post("/api/master-save", async (req, res) => {
  try {
    const { projectId, project } = req.body || {};
    if (!projectId || !project) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing projectId or project" });
    }

    const now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-");

    const snapshotKey = `storage/projects/${projectId}/producer_returns/snapshots/${ts}.json`;
    const latestKey = `storage/projects/${projectId}/producer_returns/latest.json`;

    await putJson(snapshotKey, {
      projectId,
      createdAt: now,
      source: "minisite-master-save",
      data: project,
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
    const snapKey =
      String(latest?.latestSnapshotKey || "").trim() ||
      String(latest?.snapshotKey || "").trim();

    if (!snapKey) {
      return res
        .status(404)
        .json({ ok: false, error: "NO_LATEST_SNAPSHOT_KEY", latestKey });
    }

    const snapshot = await getJson(snapKey);

    res.json({ ok: true, latestKey, latest, snapshot });
  } catch (err) {
    console.error("master-save latest error:", err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- PUBLISH: temporary minimal handler to kill 404 (wire real logic later) ----------
app.post("/api/publish-minisite", (req, res) => {
  const { projectId, snapshotKey } = req.body || {};
  if (!projectId || !snapshotKey) {
    return res
      .status(400)
      .json({ ok: false, error: "projectId and snapshotKey are required" });
  }
  return res.json({
    ok: true,
    projectId,
    snapshotKey,
    note: "publish-minisite reached",
  });
});

// ---------- STATIC FRONTEND (Vite build) ----------
const distDir = path.join(__dirname, "dist");
app.use(
  express.static(distDir, {
    etag: true,
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      // Critical: never cache the HTML shell or deploys won't show up
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// SPA fallback (must be after API routes)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "NO_ROUTE" });
  }
  return res.sendFile(path.join(distDir, "index.html"));
});

// ---------- START ----------
app.listen(port, () => {
  console.log(`album-backend listening on port ${port}`);
});
