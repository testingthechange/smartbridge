// FILE: src/minisite/catalog/Catalog.jsx
// CANONICAL CATALOG PAGE
// Do not duplicate. All routes must render this file.

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Navigate } from "react-router-dom";

import {
  loadProject,
  saveProject,
  emptySong,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
  getApiBase,
} from "./catalogCore.js";

<div style={{position:"fixed",bottom:8,right:8,fontSize:11,opacity:.7}}>
  CATALOG v2026-01-30 MASTER SAVE
</div>

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search || ""), [search]);
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function ensureCatalogShape(project, projectId) {
  const base = project && typeof project === "object" ? project : {};
  const p = {
    projectId: safeStr(base.projectId || projectId),
    title: safeStr(base.title || base.projectTitle || ""),
    producerName: safeStr(base.producerName || base.assignedProducer || ""),
    createdAt: safeStr(base.createdAt || ""),
    updatedAt: safeStr(base.updatedAt || ""),
    producerReturnReceived: Boolean(base.producerReturnReceived),
    producerReturnReceivedAt: safeStr(base.producerReturnReceivedAt || ""),
    catalog: base.catalog && typeof base.catalog === "object" ? base.catalog : {},
    masterSave:
      base.masterSave && typeof base.masterSave === "object" ? base.masterSave : {},
  };

  const songsRaw = Array.isArray(p.catalog.songs) ? p.catalog.songs : [];
  // If empty, initialize 9 slots (or preserve existing count)
  const count = songsRaw.length ? songsRaw.length : 9;
  const songs = Array.from({ length: count }, (_, i) => {
    const slot = i + 1;
    const existing = songsRaw.find((s) => Number(s?.slot) === slot);
    return existing && typeof existing === "object" ? existing : emptySong(slot);
  });

  p.catalog = { ...p.catalog, songs };
  return p;
}

export default function Catalog() {
  const { projectId: projectIdParam, page } = useParams();
  const query = useQuery();

  // Routes file uses /minisite/:projectId/:page. If someone hits wrong page, bounce.
  if (page && page !== "catalog") {
    return <Navigate to={`/minisite/${encodeURIComponent(projectIdParam || "demo")}/catalog`} replace />;
  }

  const projectId = safeStr(projectIdParam || "demo");
  const token = safeStr(query.get("token") || ""); // informational; postMasterSave reads token too

  const [project, setProject] = useState(() => ensureCatalogShape(loadProject(projectId), projectId));
  const [status, setStatus] = useState({ kind: "idle", msg: "" }); // idle | saving | ok | err
  const [confirmStep, setConfirmStep] = useState(0); // 0 none, 1 confirm armed
  const [savingLocal, setSavingLocal] = useState(false);

  // load on projectId change
  useEffect(() => {
    const loaded = ensureCatalogShape(loadProject(projectId), projectId);
    setProject(loaded);
    setStatus({ kind: "idle", msg: "" });
    setConfirmStep(0);
  }, [projectId]);

  // lightweight autosave
  useEffect(() => {
    try {
      setSavingLocal(true);
      saveProject(projectId, project);
    } finally {
      const t = setTimeout(() => setSavingLocal(false), 150);
      return () => clearTimeout(t);
    }
  }, [projectId, project]);

  const isMagic = Boolean(token);
  const linkStatusText = isMagic ? "magic-link session" : "login/unknown session";

  function updateSongTitle(slot, title) {
    setProject((prev) => {
      const next = ensureCatalogShape(prev, projectId);
      next.catalog = { ...(next.catalog || {}) };
      next.catalog.songs = (next.catalog.songs || []).map((s) => {
        if (Number(s?.slot) !== Number(slot)) return s;
        return { ...s, title: String(title ?? "") };
      });
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  async function onMasterSave() {
    setStatus({ kind: "saving", msg: "Master saving…" });

    try {
      const apiBase = getApiBase();

      // Build snapshot from current in-memory project state
      const snapshot = buildSnapshot({ projectId, project });

      // Backend wants `project` payload (not the whole snapshot)
      const projectForBackend = projectForBackendFromSnapshot(snapshot);

      // Token-aware: postMasterSave will attach Authorization if token exists (via URL or passed)
      const res = await postMasterSave({
        apiBase,
        projectId,
        projectForBackend,
        token, // optional; safe to pass
      });

      // Mark producer return received (per your intended tracking)
      const now = new Date().toISOString();
      setProject((prev) => {
        const next = ensureCatalogShape(prev, projectId);
        next.producerReturnReceived = true;
        next.producerReturnReceivedAt = now;

        next.masterSave = {
          ...(next.masterSave || {}),
          lastMasterSaveAt: now,
          sections: {
            ...(next.masterSave?.sections || {}),
            catalog: { complete: true, masterSavedAt: now },
          },
        };

        // Keep any backend info (optional)
        next.masterSave.backend = { ...(next.masterSave?.backend || {}), ...res };

        next.updatedAt = now;
        return next;
      });

      setConfirmStep(0);
      setStatus({ kind: "ok", msg: "Master Save complete." });
    } catch (e) {
      setStatus({ kind: "err", msg: e?.message || "Master Save failed." });
      setConfirmStep(0);
    }
  }

  const topRight = (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{savingLocal ? "Saving…" : "Saved"}</div>
    </div>
  );

  return (
    <div style={{ padding: 16, maxWidth: 1120, margin: "0 auto" }}>
      {/* Small header required for magic-link minisite */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          <span style={{ marginRight: 10 }}>
            <b>Project</b>: {projectId}
          </span>
          {project.title ? (
            <span style={{ marginRight: 10 }}>
              <b>Title</b>: {project.title}
            </span>
          ) : null}
          {project.producerName ? (
            <span style={{ marginRight: 10 }}>
              <b>Producer</b>: {project.producerName}
            </span>
          ) : null}
          <span style={{ marginRight: 10 }}>
            <b>Session</b>: {linkStatusText}
          </span>
        </div>
        {topRight}
      </div>

      <h2 style={{ marginTop: 14, marginBottom: 6 }}>Catalog</h2>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14 }}>
        Edit song titles here. Files/versions are handled elsewhere; Catalog Master Save locks this section.
      </div>

      {/* Song titles */}
      <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
        {project.catalog?.songs?.map((s) => (
          <div
            key={s.slot}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ width: 44, opacity: 0.75 }}>#{s.slot}</div>
            <input
              value={s.title || ""}
              onChange={(e) => updateSongTitle(s.slot, e.target.value)}
              placeholder={`Song ${s.slot} title`}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.04)",
                color: "inherit",
                outline: "none",
              }}
            />
          </div>
        ))}
      </div>

      {/* Master Save */}
      <div style={{ marginTop: 16, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Master Save</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Finalizes Catalog in the project snapshot. Use intentionally.
            </div>
          </div>

          {confirmStep === 0 ? (
            <button
              onClick={() => setConfirmStep(1)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Master Save…
            </button>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmStep(0)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={onMasterSave}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255, 77, 79, 0.35)",
                  background: "rgba(255, 77, 79, 0.14)",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                Confirm Master Save
              </button>
            </div>
          )}
        </div>

        {/* red lettering warning is appropriate here */}
        <div style={{ marginTop: 8, color: "#ff4d4f", fontSize: 12, lineHeight: 1.35 }}>
          Warning: Master Save is treated as a finalized submission. Only run this when ready.
        </div>

        {/* status */}
        {status.kind !== "idle" ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            {status.kind === "saving" ? "Working…" : null}
            {status.kind === "ok" ? "✅ " : null}
            {status.kind === "err" ? "❌ " : null}
            {status.msg}
          </div>
        ) : null}

        {/* optional: show producer return status */}
        {project.producerReturnReceived ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "rgba(68, 209, 138, 0.95)" }}>
            Producer return received{project.producerReturnReceivedAt ? ` at ${project.producerReturnReceivedAt}` : ""}.
          </div>
        ) : null}
      </div>
    </div>
  );
}
