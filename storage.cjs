// storage.cjs (local-first storage for smartbridge backend)
// Writes JSON to ./.local_storage/<key>

const fs = require("fs");
const path = require("path");

const ROOT = path.join(process.cwd(), ".local_storage");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function keyToPath(key) {
  const safe = String(key || "").replace(/^\/+/, "");
  return path.join(ROOT, safe);
}

async function putJson(key, obj) {
  const filePath = keyToPath(key);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj ?? {}, null, 2), "utf8");
  return { ok: true, key };
}

async function getJson(key) {
  const filePath = keyToPath(key);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { putJson, getJson };
