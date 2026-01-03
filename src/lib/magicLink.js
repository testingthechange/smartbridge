// ✅ NO NEW FOLDER REQUIRED (keep it simple)
//
// Add ONE small helper file + ONE page file (optional) + small edits to Projects + Project + minisite routes.
//
// Recommended minimal new files:
// 1) src/lib/magicLink.js         (token helpers + localStorage persistence for now)
// 2) src/minisite/LinkGate.jsx    (simple "invalid/expired" screen + wrapper)
// (Optional later) 3) src/pages/Project.jsx update for Send/Expire UI buttons (stubbed)

// ────────────────────────────────────────────────────────────────────────────────
// 1) NEW FILE: src/lib/magicLink.js
// ────────────────────────────────────────────────────────────────────────────────

const LS_MAGIC = "sb:magicLinks"; // { [projectId]: { token, active, expiresAt, sentAt } }

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadAll() {
  const raw = localStorage.getItem(LS_MAGIC);
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function saveAll(obj) {
  try {
    localStorage.setItem(LS_MAGIC, JSON.stringify(obj || {}));
  } catch {}
}

export function getMagic(projectId) {
  const all = loadAll();
  const row = all[String(projectId)] || null;
  if (!row) return { token: "", active: false, expiresAt: "", sentAt: "" };
  return {
    token: String(row.token || ""),
    active: !!row.active,
    expiresAt: String(row.expiresAt || ""),
    sentAt: String(row.sentAt || ""),
  };
}

export function setMagic(projectId, patch) {
  const pid = String(projectId);
  const all = loadAll();
  const prev = getMagic(pid);

  const next = {
    ...prev,
    ...patch,
    token: String(patch?.token ?? prev.token ?? ""),
    expiresAt: String(patch?.expiresAt ?? prev.expiresAt ?? ""),
    sentAt: String(patch?.sentAt ?? prev.sentAt ?? ""),
    active: typeof patch?.active === "boolean" ? patch.active : !!prev.active,
  };

  all[pid] = next;
  saveAll(all);
  return next;
}

export function randomToken(len = 18) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function computeExpiry(hours = 72) {
  const ms = Date.now() + hours * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export function isExpired(expiresAtIso) {
  if (!expiresAtIso) return false;
  const t = Date.parse(expiresAtIso);
  if (!Number.isFinite(t)) return false;
  return Date.now() > t;
}

/**
 * Validate a token against stored magic row.
 * - active must be true
 * - token must match
 * - not expired
 */
export function validateToken({ projectId, token }) {
  const m = getMagic(projectId);
  if (!m.active) return { ok: false, reason: "inactive", magic: m };
  if (!m.token) return { ok: false, reason: "missing_token", magic: m };
  if (String(token || "") !== m.token) return { ok: false, reason: "bad_token", magic: m };
  if (isExpired(m.expiresAt)) return { ok: false, reason: "expired", magic: m };
  return { ok: true, reason: "ok", magic: m };
}

// ────────────────────────────────────────────────────────────────────────────────
// 2) NEW FILE: src/minisite/LinkGate.jsx
// Wrap minisite pages with a token gate (producer link view only).
// Admin preview can bypass by passing ?admin=1 (or later auth guard).
// ────────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { validateToken, getMagic, isExpired } from "../lib/magicLink";

export default function LinkGate({ children }) {
  const { projectId } = useParams();
  const location = useLocation();

  const sp = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);
  const token = (sp.get("token") || "").trim();
  const admin = (sp.get("admin") || "").trim() === "1"; // simple bypass switch (internal only)

  const result = useMemo(() => {
    if (admin) return { ok: true, admin: true };
    return validateToken({ projectId, token });
  }, [admin, projectId, token]);

  if (result.ok) return <>{children}</>;

  const magic = getMagic(projectId);
  const expired = isExpired(magic.expiresAt);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
        Project ID: <code>{projectId}</code>
      </div>

      <div
        style={{
          border: "1px solid #fecaca",
          background: "#fee2e2",
          padding: 16,
          borderRadius: 14,
          color: "#991b1b",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900 }}>Link not available</div>

        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45 }}>
          {expired ? (
            <>
              This link has <strong>expired</strong>.
            </>
          ) : result.reason === "bad_token" ? (
            <>
              This link token is <strong>invalid</strong>.
            </>
          ) : result.reason === "inactive" ? (
            <>
              This link is <strong>inactive</strong>.
            </>
          ) : (
            <>This link is not valid.</>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Status:{" "}
          <code>
            active={String(magic.active)} · expiresAt={magic.expiresAt || "—"}
          </code>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// 3) EDIT YOUR MINISITE ROUTES: wrap minisite pages in LinkGate
// Example: in your router where you render minisite pages.
//
// BEFORE:
// <Route path="/minisite/:projectId/catalog" element={<Catalog/>} />
//
// AFTER:
// <Route path="/minisite/:projectId/catalog" element={<LinkGate><Catalog/></LinkGate>} />
// etc for Album/NFTMix/Songs/Meta
// ────────────────────────────────────────────────────────────────────────────────

// import LinkGate from "../minisite/LinkGate";
// ...
// <Route path="/minisite/:projectId/catalog" element={<LinkGate><Catalog /></LinkGate>} />
// <Route path="/minisite/:projectId/album" element={<LinkGate><Album /></LinkGate>} />
// <Route path="/minisite/:projectId/nft-mix" element={<LinkGate><NFTMix /></LinkGate>} />
// <Route path="/minisite/:projectId/songs" element={<LinkGate><Songs /></LinkGate>} />
// <Route path="/minisite/:projectId/meta" element={<LinkGate><Meta /></LinkGate>} />

// ────────────────────────────────────────────────────────────────────────────────
// 4) PROJECT PAGE (or wherever you manage a project): add minimal “Create/Expire”
// This is UI-only, no email yet. You already have a project row with magic fields.
// Use setMagic() so minisite gate works even on refresh.
// ────────────────────────────────────────────────────────────────────────────────

// Example snippet for Project page (drop into your project management UI):
//
// import { getMagic, setMagic, randomToken, computeExpiry } from "../lib/magicLink";
//
// const magic = getMagic(projectId);
//
// function activateLink() {
//   const token = randomToken(18);
//   const expiresAt = computeExpiry(72);
//   const sentAt = new Date().toISOString();
//   setMagic(projectId, { token, active: true, expiresAt, sentAt });
//   window.alert("Link activated (local only).");
// }
//
// function expireLink() {
//   setMagic(projectId, { active: false });
//   window.alert("Link expired/inactivated (local only).");
// }
//
// const url = `${window.location.origin}/minisite/${projectId}/catalog?token=${encodeURIComponent(magic.token)}`;
//
// Render:
// - Activate Link (create token + expiry + active)
// - Expire Link (active=false)
// - Copy Link button showing url
//
// NOTE: your existing project row `magic` can remain; this LS store is the gate source for now.
// Later you can swap validateToken() to check backend instead.

// ────────────────────────────────────────────────────────────────────────────────
// 5) IMPORTANT: Producer link must NOT show Dashboard
// You already enforce this by routing (don’t render dashboard routes under /minisite).
// Also: do NOT show internal nav when token-gated; keep minisite nav only.
// ────────────────────────────────────────────────────────────────────────────────
