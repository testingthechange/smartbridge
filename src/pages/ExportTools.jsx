// src/pages/ExportTools.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
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

  const API_BASE = String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");

  const [snapshotKey, setSnapshotKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  // Load local publish + producerId (so we can mirror into the right projects index)
  const proj = useMemo(() => (projectId ? loadProjectLocal(projectId) : null), [projectId]);
  const producerId = String(proj?.producerId || "").trim();

  const published = useMemo(() => {
    if (!proj) return null;
    return proj.publish || null;
  }, [proj, result]);

  // 1) Hydrate snapshotKey from local project.publish.snapshotKey if present
  useEffect(() => {
    if (!projectId) return;
    const k = String(proj?.publish?.snapshotKey || "").trim();
    if (k) setSnapshotKey(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 2) If snapshotKey still blank, fetch it from backend latest master-save
  useEffect(() => {
    if (!projectId) return;
    if (!API_BASE) return;
    if (snapshotKey.trim()) return;

    let cancelled = false;

    async function run() {
      try {
        const r = await fetch(`${API_BASE}/api/master-save/latest/${encodeURIComponent(projectId)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) return;

        const k =
          String(j?.latest?.latestSnapshotKey || "").trim() ||
          String(j?.latestSnapshotKey || "").trim();

        if (!cancelled && k) setSnapshotKey(k);
      } catch {
        // ignore
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [API_BASE, projectId, snapshotKey]);

  const doPublish = async () => {
    if (!projectId) return;
    if (!API_BASE) return window.alert("Missing VITE_BACKEND_URL in .env.local");
    if (!snapshotKey.trim()) return window.alert("Snapshot Key required.");

    setLoading(true);
    setErr("");
    setResult(null);

    try {
      // ✅ FIX: backend route is /api/publish-minisite (NOT /api/publish)
      const r = await fetch(`${API_BASE}/api/publish-minisite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, snapshotKey: snapshotKey.trim() }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setResult(j);

      // ✅ persist publish output so it never “vanishes”
      savePublishResultToLocal({
        projectId,
        producerId,
        snapshotKey: snapshotKey.trim(),
        shareId: j.shareId,
        publicUrl: j.publicUrl,
        manifestKey: j.manifestKey,
      });
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

      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Publisher (S3)</div>

        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>
          Snapshot Key
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={snapshotKey}
            onChange={(e) => setSnapshotKey(e.target.value)}
            placeholder="storage/projects/123456/producer_returns/snapshots/2025-12-21T....json"
            style={input()}
          />

          <button type="button" onClick={doPublish} disabled={loading} style={primaryBtn(loading)}>
            {loading ? "Publishing…" : "Publish Mini-site"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          If this field is blank, do a Master Save first (Catalog or Album), then come back here.
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
        <pre style={pre()}>{result ? JSON.stringify(result, null, 2) : published ? JSON.stringify(published, null, 2) : "{\n  \n}"}</pre>
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
  };
}
