// src/minisite/Album.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { masterSaveMiniSite } from "../lib/masterSaveMiniSite.js";

/* ---------- local helpers ---------- */

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

/* ---------- Album ---------- */

export default function Album() {
  const { projectId } = useParams();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  const project = useMemo(() => {
    if (!projectId) return null;
    return loadProject(projectId);
  }, [projectId, tick]);

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>No project loaded</div>;

  const catalogSongs = Array.isArray(project?.catalog?.songs)
    ? project.catalog.songs
    : [];

  const meta = project?.album?.meta || {};
  const albumTitle = meta.albumTitle || "";
  const artistName = meta.artistName || "";
  const releaseDate = meta.releaseDate || "";

  function setMetaField(key, value) {
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        meta: {
          ...(project.album?.meta || {}),
          [key]: value,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setTick((n) => n + 1);
  }

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
      if (!snapshotKey) throw new Error("No snapshotKey returned");

      const now = new Date().toISOString();

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
      setTick((n) => n + 1);

      alert("Album Master Save OK");
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, padding: 24 }}>
      <h2>Album</h2>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Project {projectId}</div>

      {/* Catalog mirror */}
      <div style={{ marginTop: 20 }}>
        <h3>Catalog Songs</h3>
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

      {/* Album Meta */}
      <div
        style={{
          marginTop: 28,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
        }}
      >
        <h3>Album Meta</h3>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Album Title</div>
          <input
            value={albumTitle}
            onChange={(e) => setMetaField("albumTitle", e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Artist Name</div>
          <input
            value={artistName}
            onChange={(e) => setMetaField("artistName", e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Release Date</div>
          <input
            type="date"
            value={releaseDate}
            onChange={(e) => setMetaField("releaseDate", e.target.value)}
            style={{ padding: 8 }}
          />
        </div>
      </div>

      {/* Master Save */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <button
          type="button"
          onClick={onMasterSave}
          disabled={busy}
          style={{
            padding: "12px 16px",
            fontWeight: 900,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Master Save Album"}
        </button>

        {project?.master?.isMasterSaved ? (
          <div style={{ marginTop: 10, color: "#065f46", fontWeight: 900 }}>
            ✅ Album Master Saved
          </div>
        ) : null}

        {project?.master?.lastSnapshotKey ? (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            Snapshot: <code>{project.master.lastSnapshotKey}</code>
          </div>
        ) : null}

        {project?.master?.masterSavedAt ? (
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
            Saved @ {project.master.masterSavedAt}
          </div>
        ) : null}

        {err ? (
          <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
