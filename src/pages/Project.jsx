// src/pages/Project.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

/**
 * Project detail page (internal/admin)
 * Magic Link controls:
 * - Send (create/activate + copy link)
 * - Resend (copy same active link)
 * - Expire (deactivate)
 * - Admin Preview (bypass, opens minisite with ?admin=1)
 *
 * Storage:
 * - project_{projectId} blob is source of truth (snap.magic)
 * - optional lookup row: sb:magic:<token>
 */

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

// Token lookup (optional, future /p/:token routes)
function magicKey(token) {
  return `sb:magic:${String(token || "")}`;
}

function makeToken() {
  const a = Math.random().toString(36).slice(2);
  const b = Math.random().toString(36).slice(2);
  return `${a}${b}`.slice(0, 24);
}

function upsertMagicLookup({ token, projectId, producerId, expiresAt, active }) {
  if (!token) return;
  const payload = {
    token: safeString(token),
    projectId: safeString(projectId),
    producerId: safeString(producerId),
    expiresAt: safeString(expiresAt),
    active: !!active,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(magicKey(token), JSON.stringify(payload));
}

function isMagicActive(magic) {
  if (!magic) return false;
  if (!magic.active) return false;

  const exp = safeString(magic.expiresAt);
  if (!exp) return true;

  const t = Date.parse(exp);
  if (!Number.isFinite(t)) return true;

  return Date.now() < t;
}

function loadProjectLocal(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

function seedProjectIfMissing(projectId) {
  const existing = loadProjectLocal(projectId);
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  const seed = {
    projectId: safeString(projectId),
    projectName: "Project",
    producerId: "",
    company: "",
    date: "",
    createdAt: nowIso,
    updatedAt: nowIso,
    catalog: { songs: [] },
    album: { meta: {} },
    nftMix: {},
    songs: {},
    meta: { songs: [] },
    magic: { token: "", active: false, expiresAt: "", sentAt: "" },
    master: {
      isMasterSaved: false,
      masterSavedAt: "",
      lastSnapshotKey: "",
      producerReturnReceived: false,
      producerReturnReceivedAt: "",
    },
    publish: {
      lastShareId: "",
      lastPublicUrl: "",
      publishedAt: "",
      manifestKey: "",
      snapshotKey: "",
    },
  };

  localStorage.setItem(projectKey(projectId), JSON.stringify(seed));
  return seed;
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
    setSnap(seedProjectIfMissing(projectId));
  }, [projectId]);

  useEffect(() => {
    const onFocus = () => {
      if (!projectId) return;
      setSnap(seedProjectIfMissing(projectId));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId]);

  useEffect(() => {
    const onStorage = (e) => {
      if (!projectId) return;
      if (e?.key === projectKey(projectId) || e?.key?.includes("sb:projects_index:")) {
        setSnap(seedProjectIfMissing(projectId));
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

  // ────────────────────────────────────────────────────────────────────────────────
  // Magic link state + actions (stored in project_{id}.magic)
  // ────────────────────────────────────────────────────────────────────────────────

  const magic = useMemo(() => {
    const m = snap?.magic || {};
    return {
      token: safeString(m.token),
      active: !!m.active,
      expiresAt: safeString(m.expiresAt),
      sentAt: safeString(m.sentAt),
    };
  }, [snap]);

  const magicStatus = useMemo(() => {
    if (!magic.token) return "Not sent";
    return isMagicActive(magic) ? "Active" : "Expired";
  }, [magic]);

  const magicUrl = useMemo(() => {
    if (!magic.token) return "";
    return `${window.location.origin}/minisite/${projectId}/catalog?token=${encodeURIComponent(
      magic.token
    )}`;
  }, [magic.token, projectId]);

  const saveSnap = (next) => {
    if (!projectId) return;
    localStorage.setItem(projectKey(projectId), JSON.stringify(next));
    setSnap(next);
  };

  const copyToClipboardOrAlert = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      window.alert(`Copied link:\n${text}`);
    } catch {
      window.alert(text);
    }
  };

  const sendMagic = async () => {
    if (!projectId) return;
    const base = snap || seedProjectIfMissing(projectId);

    const nowIso = new Date().toISOString();

    // Mint only when none OR expired/inactive
    const currentlyActive = isMagicActive(base?.magic);
    let nextToken = safeString(base?.magic?.token);
    if (!nextToken || !currentlyActive) nextToken = makeToken();

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const nextMagic = {
      token: nextToken,
      active: true,
      expiresAt,
      sentAt: nowIso,
    };

    const next = { ...base, magic: nextMagic, updatedAt: nowIso };
    saveSnap(next);

    upsertMagicLookup({
      token: nextToken,
      projectId,
      producerId: safeString(next?.producerId),
      expiresAt,
      active: true,
    });

    await copyToClipboardOrAlert(
      `${window.location.origin}/minisite/${projectId}/catalog?token=${encodeURIComponent(nextToken)}`
    );
  };

  const resendMagic = async () => {
    if (!projectId) return;
    const base = snap || seedProjectIfMissing(projectId);

    const token = safeString(base?.magic?.token);
    if (!token || !isMagicActive(base?.magic)) {
      window.alert("No active magic link to resend. Use Send to create a new one.");
      return;
    }

    await copyToClipboardOrAlert(
      `${window.location.origin}/minisite/${projectId}/catalog?token=${encodeURIComponent(token)}`
    );
  };

  const expireMagic = () => {
    if (!projectId) return;
    const base = snap || seedProjectIfMissing(projectId);

    const token = safeString(base?.magic?.token);
    if (!token) return;

    const nowIso = new Date().toISOString();

    const nextMagic = {
      ...base.magic,
      active: false,
      expiresAt: nowIso,
    };

    const next = { ...base, magic: nextMagic, updatedAt: nowIso };
    saveSnap(next);

    upsertMagicLookup({
      token,
      projectId,
      producerId: safeString(next?.producerId),
      expiresAt: nowIso,
      active: false,
    });

    window.alert("Magic link expired (inactive).");
  };

  const adminPreview = () => {
    const url = magicUrl;
    if (!url) {
      window.alert("No token yet. Click Send first.");
      return;
    }
    window.open(`${url}&admin=1`, "_blank", "noreferrer");
  };

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
          Mini-site (internal quick links)
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
          Magic Link (producer)
        </div>

        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7 }}>
          <div>
            Status: <strong>{magicStatus}</strong>
          </div>
          <div>
            Expires At:{" "}
            {magic.expiresAt ? <code>{magic.expiresAt}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Sent At:{" "}
            {magic.sentAt ? <code>{magic.sentAt}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Token: {magic.token ? <code>{magic.token}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>
          <div>
            Link: {magicUrl ? <code>{magicUrl}</code> : <span style={{ opacity: 0.65 }}>—</span>}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={sendMagic} style={btnPrimary()}>
              Send (copy link)
            </button>
            <button type="button" onClick={resendMagic} style={btn()}>
              Resend (copy same link)
            </button>
            <button type="button" onClick={expireMagic} style={btnDanger()}>
              Expire
            </button>
            <button type="button" onClick={adminPreview} style={btn()}>
              Admin Preview
            </button>
          </div>
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
            {pub?.snapshotKey ? <code>{pub?.snapshotKey}</code> : <span style={{ opacity: 0.65 }}>—</span>}
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

function btn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function btnPrimary() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function btnDanger() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#b91c1c",
    fontWeight: 900,
    cursor: "pointer",
  };
}
