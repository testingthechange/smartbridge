// FILE: src/minisite/catalog/Catalog.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  emptySong,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
  getApiBase,
} from "./catalogCore.js";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search || ""), [search]);
}

function ensureProject(project, projectId) {
  const base = project && typeof project === "object" ? project : {};
  const songsRaw = Array.isArray(base?.catalog?.songs) ? base.catalog.songs : [];
  const songs = songsRaw.length
    ? songsRaw
    : Array.from({ length: 9 }, (_, i) => emptySong(i + 1));

  return {
    projectId: String(base.projectId || projectId),
    title: String(base.title || ""),
    producerName: String(base.producerName || ""),
    catalog: { ...(base.catalog || {}), songs },
    masterSave: base.masterSave || {},
    producerReturnReceived: Boolean(base.producerReturnReceived),
    producerReturnReceivedAt: String(base.producerReturnReceivedAt || ""),
  };
}

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const query = useQuery();

  const projectId = String(projectIdParam || "demo");
  const token = String(query.get("token") || "");

  const [project, setProject] = useState(() => ensureProject(loadProject(projectId), projectId));
  const [confirmStep, setConfirmStep] = useState(0);
  const [status, setStatus] = useState("");

  function updateSongTitle(slot, title) {
    setProject((prev) => {
      const next = ensureProject(prev, projectId);
      next.catalog.songs = next.catalog.songs.map((s) =>
        Number(s.slot) === Number(slot) ? { ...s, title: String(title || "") } : s
      );
      saveProject(projectId, next);
      return next;
    });
  }

  async function onMasterSave() {
    setStatus("Master saving…");
    try {
      const apiBase = getApiBase();
      const snapshot = buildSnapshot({ projectId, project });
      const projectForBackend = projectForBackendFromSnapshot(snapshot);

      await postMasterSave({ apiBase, projectId, projectForBackend, token });

      const now = new Date().toISOString();
      setProject((prev) => {
        const next = ensureProject(prev, projectId);
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
        saveProject(projectId, next);
        return next;
      });

      setConfirmStep(0);
      setStatus("Master Save complete.");
    } catch (e) {
      setConfirmStep(0);
      setStatus(e?.message || "Master Save failed.");
    }
  }

  return (
    <div>
      <div style={{ border: "2px solid blue", padding: 10, marginBottom: 12 }}>
        CATALOG IS RENDERING — projectId={projectId} token={token ? "yes" : "no"}
      </div>

      <h2>Catalog</h2>

      <div style={{ border: "1px solid rgba(0,0,0,0.2)", borderRadius: 10, padding: 12 }}>
        {project.catalog.songs.map((s) => (
          <div key={s.slot} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <div style={{ width: 40, opacity: 0.7 }}>#{s.slot}</div>
            <input
              value={s.title || ""}
              onChange={(e) => updateSongTitle(s.slot, e.target.value)}
              placeholder={`Song ${s.slot} title`}
              style={{ flex: 1, padding: "8px 10px" }}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, border: "1px solid rgba(0,0,0,0.2)", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Master Save</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Warning: finalizes Catalog snapshot.
            </div>
          </div>

          {confirmStep === 0 ? (
            <button onClick={() => setConfirmStep(1)}>Master Save…</button>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmStep(0)}>Cancel</button>
              <button onClick={onMasterSave} style={{ border: "1px solid red" }}>
                Confirm Master Save
              </button>
            </div>
          )}
        </div>

        {status ? <div style={{ marginTop: 10, fontSize: 12 }}>{status}</div> : null}
      </div>

      {project.producerReturnReceived ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "green" }}>
          Producer return received at {project.producerReturnReceivedAt}
        </div>
      ) : null}
    </div>
  );
}
