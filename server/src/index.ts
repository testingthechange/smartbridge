import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config(); // Render uses injected env vars; local can still use .env/.env.local if you run it

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Health (keep both)
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION;

if (!BUCKET) throw new Error("Missing env S3_BUCKET");
if (!REGION) throw new Error("Missing env AWS_REGION");

const s3 = new S3Client({ region: REGION });

// in-memory upload (fine for now; later we can stream if needed)
const upload = multer();

/**
 * MP3 Upload -> S3
 * Expects multipart/form-data:
 * - projectId
 * - trackId
 * - file (mp3)
 */
app.post("/api/upload-mp3", upload.single("file"), async (req, res) => {
  try {
    const { projectId, trackId } = req.body ?? {};
    if (!projectId || !trackId) {
      return res.status(400).json({ error: "Missing projectId/trackId" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing file" });
    }

    const Key = `storage/projects/${projectId}/audio/mp3/${trackId}.mp3`;

    const out = await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: req.file.buffer,
        ContentType: "audio/mpeg",
        ServerSideEncryption: "AES256",
      })
    );

    res.json({ s3Key: Key, etag: out.ETag ?? null });
  } catch (e) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

/**
 * Master Save JSON Snapshot -> S3
 * Expects JSON body:
 * { projectId, masterSaveId, masterSave }
 */
app.post("/api/master-save", async (req, res) => {
  try {
    const { projectId, masterSaveId, masterSave } = req.body ?? {};
    if (!projectId || !masterSaveId || !masterSave) {
      return res.status(400).json({ error: "Missing projectId/masterSaveId/masterSave" });
    }

    const Key = `storage/projects/${projectId}/master_save/${masterSaveId}.json`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: Buffer.from(JSON.stringify(masterSave, null, 2), "utf-8"),
        ContentType: "application/json",
        ServerSideEncryption: "AES256",
      })
    );

    res.json({ s3Key: Key });
  } catch (e) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

const port = Number(process.env.PORT || 5174);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
