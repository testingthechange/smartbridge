// server/routes/publishMiniSite.js
import express from "express";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET;

// OPTIONAL: if you serve public S3 via a CDN or website origin, set this
// e.g. https://cdn.yoursite.com or https://your-bucket.s3.amazonaws.com
const PUBLIC_BASE = process.env.PUBLIC_PLAYERS_BASE_URL || "";

async function putObject({ key, body, contentType }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store",
    })
  );
}

router.post("/publish-minisite", async (req, res) => {
  try {
    const { projectId, snapshotKey } = req.body || {};
    if (!projectId || !snapshotKey) {
      return res.status(400).json({ ok: false, error: "projectId and snapshotKey are required" });
    }

    const shareId = crypto.randomBytes(8).toString("hex");
    const baseKey = `public/players/${shareId}`;

    const manifest = {
      ok: true,
      projectId,
      snapshotKey,
      shareId,
      publishedAt: new Date().toISOString(),
      version: 1,
    };

    const manifestKey = `${baseKey}/manifest.json`;
    await putObject({
      key: manifestKey,
      body: Buffer.from(JSON.stringify(manifest, null, 2)),
      contentType: "application/json; charset=utf-8",
    });

    // Minimal static page. You can replace this with your real public player entry.
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Smart Bridge Minisite</title>
</head>
<body>
  <h3>Smart Bridge Minisite</h3>
  <p>This share points at a Master Save snapshot.</p>
  <pre id="out">Loading manifest…</pre>
  <script>
    fetch("./manifest.json")
      .then(r => r.json())
      .then(m => {
        document.getElementById("out").textContent = JSON.stringify(m, null, 2);
      })
      .catch(err => {
        document.getElementById("out").textContent = String(err);
      });
  </script>
</body>
</html>`;

    const indexKey = `${baseKey}/index.html`;
    await putObject({
      key: indexKey,
      body: Buffer.from(html),
      contentType: "text/html; charset=utf-8",
    });

    const publicUrl = PUBLIC_BASE
      ? `${PUBLIC_BASE}/${baseKey}/index.html`
      : `/${baseKey}/index.html`; // fallback (depends on your hosting)

    return res.json({ ok: true, shareId, publicUrl, manifestKey });
  } catch (e) {
    console.error("publish-minisite error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
