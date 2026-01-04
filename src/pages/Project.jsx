// src/pages/Project.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

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

function indexKey(producerId) {
  return `sb:projects_index:${String(producerId || "no-producer")}`;
}

function loadProjectLocal(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

function loadPublishFromProducerIndex(producerId, projectId) {
  if (!producerId || !projectId) return null;
  const raw = localStorage.getItem(indexKey(producerId));
  const rows = raw ? safeParse(raw) : null;
  if (!Array.isArray(rows)) return null;

  const row = rows.find((r) => String(r?.projectId) === String(projectId));
  const p = row?.publish || null;
  if (!p || typeof p !== "object") return null;

  return {
    lastShareId: safeString(p.lastShareId),
    lastPublicUrl: safeString(p.lastPublicUrl),
    manifestKey: safeString(p.manifestKey),
    publishedAt: safeString(p.publishedAt),
    snapshotKey: safeString(p.snapshotKey),
  };
}

export default function Project() {
  const { projectId } = useParams();
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    setSnap(loadProjectLocal(projectId));
  }, [projectId]);

  useEffect(() => {
    const onFocus = () => {
      if (!projectId) return;
      setSnap(loadProjectLocal(projectId));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId]);

  useEffect(() => {
    const onStorage = (e) => {
      if (!projectId) return;
      if (e?.key === projectKey(projectId) || e?.key?.includes("sb:projects_index:")) {
        setSnap(loadProjectLocal(projectId));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  const producerId = safeString(snap?.producerId);

  const pub = useMemo(() => {
    const p = snap?.publish || {};
    const fromBlob = {
      lastShareId: safeString(p.lastShareId),
      lastPublicUrl: safeString(p.lastPublicUrl),
      manifestKey: safeString(p.manifestKey),
      publishedAt: safeString(p.publishedAt),
      snapshotKey: safeString(p.snapshotKey),
    };

    const hasAny =
      !!fromBlob.lastShareId ||
      !!fromBlob.lastPublicUrl ||
      !!fromBlob.manifestKey ||
      !!fromBlob.publishedAt ||
      !!fromBlob.snapshotKey;

    if (hasAny) return fromBlob;

    const fromIndex = loadPublishFromProducerIndex(producerId, projectId);
    return fromIndex || fromBlob;
  }, [snap, producerId, projectId]);

  const backHref = producerId ? `/producer/${encodeURIComponent(producerId)}/projects` : null;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ fontSize: 34, fontWeight: 900, color: "#0f172a" }}>
        {snap?.projectName || "Project"}
      </div>

      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Project ID: <strong>{projectId}</strong> · Producer:{" "}
        <strong>{producerId || "—"}</strong>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>
          Mini-site
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to={`/minisite/${projectId}/catalog`} style={pill()}>
            Catalog
          </Link>
          <Link to={`/minisite/${projectId}/album`} style={pill()}>
            Album
          </Link>
          <Link to={`/minisite/${projectId}/nft-mix`} style={pill()}>
            NFT Mix
          </Link>
          <Link to={`/minisite/${projectId}/songs`} style={pill()}>
            Songs
          </Link>
          <Link to={`/minisite/${projectId}/meta`} style={pill()}>
            Meta
          </Link>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Status badges (✅ Master / ✅ Return / ✅ Published) are shown on the Projects list page.
        </div>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>
          Publish
        </div>

        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7 }}>
          <div>
            Published At:{" "}
            {pub?.publishedAt ? <code>{pub.publishedAt}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Share ID:{" "}
            {pub?.lastShareId ? <code>{pub.lastShareId}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Manifest Key:{" "}
            {pub?.manifestKey ? <code>{pub.manifestKey}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Public URL:{" "}
            {pub?.lastPublicUrl ? (
              <a href={pub.lastPublicUrl} target="_blank" rel="noreferrer">
                {pub.lastPublicUrl}
              </a>
            ) : (
              <span style={{ opacity: 0.65 }}>—</span>
            )}
          </div>
          <div>
            Snapshot Key:{" "}
            {pub?.snapshotKey ? <code>{pub.snapshotKey}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>

          <div style={{ marginTop: 10 }}>
            <Link to={`/minisite/${projectId}/export`} style={ghostLink()}>
              Go to Export / Tools
            </Link>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
          Local project snapshot (debug)
        </div>
        <pre style={pre()}>{snap ? JSON.stringify(snap, null, 2) : "{\n  \n}"}</pre>
      </div>

      <div style={{ marginTop: 12 }}>
        {backHref ? (
          <Link to={backHref} style={ghostLink()}>
            ← Back to producer projects
          </Link>
        ) : (
          <span style={{ ...ghostLink(), opacity: 0.5 }}>← Back to producer projects</span>
        )}
      </div>
    </div>
  );
}

function card() {
  return { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}

function pill() {
  return {
    textDecoration: "none",
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
  };
}

function ghostLink() {
  return { textDecoration: "none", fontWeight: 900, color: "#1d4ed8" };
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
