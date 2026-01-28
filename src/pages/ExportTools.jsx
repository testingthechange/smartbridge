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

  // single source of truth
  const API_BASE = useMemo(() => {
    return String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/+$/, "");
  }, []);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

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
        "Missing VITE_API_BASE.\n" +
          "Example:\nVITE_API_BASE=https://album-backend-kmuo.onrender.com"
      );
    }

    setLoading(true);
    setErr("");
    setResult(null);

    try {
      // ✅ Always publish latest (backend uses producer_returns/latest.json)
      const body = { projectId };

      const r = await fetch(`${API_BASE}/api/publish-minisite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setResult(j);

      const returnedSnapshotKey = normalizeSnapshotKey(j?.snapshotKey);

      savePublishResultToLocal({
        projectId,
        producerId,
        snapshotKey: returnedSnapshotKey,
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

  const lastShareId = safeString(published?.lastShareId);
  const lastPublicUrl = safeString(published?.lastPublicUrl);

  return (
    <div style={{ maxWidth: 1100 }}>
    <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Export / Tools (OPTION A BUILD)</div>

      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Project ID: <code>{projectId}</code>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
        Backend: <span style={{ fontFamily: "monospace" }}>{API_BASE || "—"}</span>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Publisher (S3)</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Publishes from <code>producer_returns/latest.json</code>.
            </div>
          </div>

          <button type="button" onClick={doPublish} disabled={loading} style={primaryBtn(loading)}>
            {loading ? "Publishing…" : "Publish Mini-site"}
          </button>
        </div>

        {err ? <div style={{ marginTop: 12, ...errorBox() }}>{err}</div> : null}

        <div style={{ marginTop: 18, fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Published</div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 8, columnGap: 12 }}>
          <div style={label()}>Share ID</div>
          <div style={valueMono()}>{lastShareId || "—"}</div>

          <div style={label()}>Public URL</div>
          <div style={valueMono()}>
            {lastPublicUrl ? (
              <a href={lastPublicUrl} target="_blank" rel="noreferrer">
                {lastPublicUrl}
              </a>
            ) : (
              "—"
            )}
          </div>

          <div style={label()}>Published At</div>
          <div style={valueMono()}>{safeString(published?.publishedAt) || "—"}</div>

          <div style={label()}>Snapshot Key</div>
          <div style={valueMono()}>{safeString(published?.snapshotKey) || "—"}</div>
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

function label() {
  return { fontSize: 12, fontWeight: 900, opacity: 0.65, textTransform: "uppercase" };
}

function valueMono() {
  return { fontSize: 13, fontFamily: "monospace", opacity: 0.9 };
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
