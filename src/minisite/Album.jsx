// src/minisite/Album.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { masterSaveMiniSite } from "../lib/masterSaveMiniSite.js";

function loadProject(projectId) {
  try {
    const raw = localStorage.getItem(`project_${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveProject(projectId, project) {
  localStorage.setItem(`project_${projectId}`, JSON.stringify(project));
}

export default function Album() {
  const { projectId } = useParams();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const project = useMemo(() => loadProject(projectId), [projectId]);

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>No project loaded</div>;

  const catalogSongs = Array.isArray(project?.catalog?.songs)
    ? project.catalog.songs
    : [];

  async function onMasterSave() {
    if (busy) return;
    setBusy(true);
    setErr("");

    try {
      const res = await masterSaveMiniSite({
        projectId,
        project,
      });

      const snapshotKey = String(res?.snapshotKey || "");
      const now = new Date().toISOString();

      if (!snapshotKey) throw new Error("No snapshotKey returned");

      const next = {
        ...project,
        master: {
          ...(project.master || {}),
          isMasterSaved: true,
          masterSavedAt: now,
          lastSnapshotKey: snapshotKey,
        },
        publish: {
          ...(project.publish || {}),
          snapshotKey,
        },
        updatedAt: now,
      };

      saveProject(projectId, next);
      setSavedAt(now);
      alert("Album Master Save OK");
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, padding: 24 }}>
      <h2>Album (v0)</h2>
      <div style={{ opacity: 0.7, fontSize: 12 }}>Project {projectId}</div>

      <div style={{ marginTop: 20 }}>
        <h3>Catalog mirror</h3>
        {catalogSongs.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No catalog songs</div>
        ) : (
          <ul>
            {catalogSongs.map((s) => (
              <li key={s.slot}>
                #{s.slot} — {s.title || "—"}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 30, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
        <button
          type="button"
          onClick={onMasterSave}
          disabled={busy}
          style={{
            padding: "12px 16px",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Master Save Album"}
        </button>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          {savedAt
            ? `Album Master Saved @ ${savedAt}`
            : project?.master?.masterSavedAt
            ? `Album Master Saved @ ${project.master.masterSavedAt}`
            : "—"}
        </div>

        {err ? (
          <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
