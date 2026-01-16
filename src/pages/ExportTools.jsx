// src/pages/ExportTools.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeString(v) {
  return String(v ?? "").trim();
}

function projectKey(projectId) {
  return `project_${projectId}`;
}

function loadProjectLocal(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

function saveProjectLocal(projectId, obj) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(obj || {}));
}

function indexKey(producerId) {
  return `sb:projects_index:${String(producerId || "no-producer")}`;
}

function loadProjectsIndex(producerId) {
  const raw = localStorage.getItem(indexKey(producerId));
  const parsed = raw ? safeParse(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function saveProjectsIndex(producerId, rows) {
  localStorage.setItem(indexKey(producerId), JSON.stringify(Array.isArray(rows) ? rows : []));
}

function normalizeSnapshotKey(k) {
  const s = safeString(k);
  if (!s) return "";
  // masterSnapshot_* is NOT a real S3 key; ignore it
  if (s.startsWith("masterSnapshot_")) return "";
  return s;
}

function savePublishResultToLocal({ projectId, producerId, snapshotKey, shareId, publicUrl, manifestKey }) {
  if (!projectId) return;

  const nowIso = new Date().toISOString();

  // update project blob
  const proj = loadProjectLocal(projectId);
  if (proj) {
    proj.publish = {
      ...(proj.publish || {}),
      lastShareId: String(shareId || ""),
      lastPublicUrl: String(publicUrl || ""),
      manifestKey: String(manifestKey || ""),
      publishedAt: nowIso,
      // IMPORTANT: store the REAL S3 snapshotKey returned by backend (if any)
      snapshotKey: String(snapshotKey || ""),
    };
    proj.updatedAt = nowIso;
    saveProjectLocal(projectId, proj);
  }

  // mirror into producer-scoped index row
  if (producerId) {
    const rows = loadProjectsIndex(producerId);
    const next = (rows || []).map((r) => {
      if (String(r?.projectId) !== String(projectId)) return r;
      return {
        ...r,
        updatedAt: nowIso,
        publish: {
          ...(r.publish || {}),
          lastShareId: String(shareId || ""),
          lastPublicUrl: String(publicUrl || ""),
          manifestKey: String(manifestKey || ""),
          publishedAt: nowIso,
          snapshotKey: String(snapshotKey || ""),
        },
      };
    });
    saveProjectsIndex(producerId, next);
  }
}

export default function ExportTools() {
  const { projectId } = useParams();

  // ✅ single source of truth; match Catalog.jsx
  const API_BASE = useMemo(() => {
    return String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/+$/, "");
  }, []);

  // ✅ IMPORTANT: this field must be allowed to stay blank (no auto-repopulate)
  const [snapshotKey, setSnapshotKey] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  // Load local publish + producerId (so we can mirror into the right projects index)
  const proj = useMemo(() => (projectId ? loadProjectLocal(projectId) : null), [projectId, result]);
  const producerId = safeString(proj?.producerId);

  const published = useMemo(() => {
    if (!proj) return null;
    return proj.publish || null;
  }, [proj]);

  const doPublish = async () => {
    if (!projectId) return;

    if (!API_BASE) {
      return window.alert(
        "Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.\n" +
          "Example: VITE_API_BASE=https://album-backend-kmuo.onrender.com"
      );
    }

    setLoading(true);
    setErr("");
    setResult(null);

    try {
      const snap = normalizeSnapshotKey(snapshotKey);

      // ✅ Allow publishing without snapshotKey (backend will use producer_returns/latest.json)
      const body = snap ? { projectId, snapshotKey: snap } : { projectId };

      const r = await fetch(`${API_BASE}/api/publish-minisite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setResult(j);

      // ✅ Persist the REAL snapshotKey returned by backend (if present)
      const returnedSnapshotKey = normalizeSnapshotKey(j?.snapshotKey);

      savePublishResultToLocal({
        projectId,
        producerId,
        snapshotKey: returnedSnapshotKey,
        shareId: j.shareId,
        publicUrl: j.publicUrl,
        manifestKey: j.manifestKey,
      });

      // ✅ Do NOT auto-fill the input (keep blank behavior)
      // If you want to show what was used, rely on the Result panel instead.
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Export / Tools</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Project ID: <code>{projectId}</code>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
        Backend: <span style={{ fontFamily: "monospace" }}>{API_BASE || "—"}</span>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Publisher (S3)</div>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>
          Snapshot Key (optional)
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={snapshotKey}
            onChange={(e) => setSnapshotKey(e.target.value)}
            placeholder="(leave blank to publish latest master-save)"
            style={input()}
          />

          <button type="button" onClick={doPublish} disabled={loading} style={primaryBtn(loading)}>
            {loading ? "Publishing…" : "Publish Mini-site"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          If blank, the backend publishes from <code>producer_returns/latest.json</code>.
        </div>

        {err ? <div style={{ marginTop: 12, ...errorBox() }}>{err}</div> : null}

        <div style={{ marginTop: 18, fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Published URL</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {published?.lastPublicUrl ? (
            <a href={published.lastPublicUrl} target="_blank" rel="noreferrer">
              {published.lastPublicUrl}
            </a>
          ) : (
            <span style={{ opacity: 0.65 }}>—</span>
          )}
        </div>

        <div style={{ marginTop: 18, fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Result</div>
        <pre style={pre()}>
          {result ? JSON.stringify(result, null, 2) : published ? JSON.stringify(published, null, 2) : "{\n  \n}"}
        </pre>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */

function card() {
  return { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}

function input() {
  return {
    flex: 1,
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid #d1d5db",
    fontSize: 15,
    outline: "none",
    background: "#fff",
    fontFamily: "monospace",
  };
}

function primaryBtn(disabled) {
  return {
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #111827",
    background: disabled ? "#e5e7eb" : "#111827",
    color: disabled ? "#6b7280" : "#f9fafb",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };
}

function pre() {
  return {
    marginTop: 10,
    background: "#0b1220",
    color: "#e5e7eb",
    borderRadius: 14,
    padding: 14,
    fontSize: 12,
    overflowX: "auto",
    lineHeight: 1.6,
  };
}

function errorBox() {
  return {
    fontSize: 12,
    color: "#991b1b",
    background: "#fee2e2",
    border: "1px solid #fecaca",
    padding: 10,
    borderRadius: 12,
    whiteSpace: "pre-wrap",
  };
}
