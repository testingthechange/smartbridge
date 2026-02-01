// FILE: src/minisite/Catalog.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ensureProject, loadProject, setSection } from "./catalogCore.js";

export default function Catalog() {
  const { projectId } = useParams();
  const pid = String(projectId || "").trim();

  const [project, setProject] = useState(null);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    if (!pid) return;
    ensureProject(pid);
    setProject(loadProject(pid));
  }, [pid]);

  const songs = useMemo(() => {
    const arr = project?.catalog?.songs;
    return Array.isArray(arr) ? arr : [];
  }, [project]);

  function refresh() {
    setProject(loadProject(pid));
  }

  function addSong() {
    const t = String(titleDraft || "").trim();
    if (!t) return;

    const nextSongs = [
      ...songs,
      { title: t, createdAt: new Date().toISOString() },
    ];

    setSection(pid, "catalog", { ...(project?.catalog || {}), songs: nextSongs });
    setTitleDraft("");
    refresh();
  }

  function removeSong(idx) {
    const nextSongs = songs.filter((_, i) => i !== idx);
    setSection(pid, "catalog", { ...(project?.catalog || {}), songs: nextSongs });
    refresh();
  }

  if (!pid) return <div style={{ padding: 16 }}>Missing projectId</div>;

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ padding: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 900 }}>CATALOG — TITLES (localStorage)</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          projectId: <b>{pid}</b>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Add song title"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
        />
        <button
          onClick={addSong}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", background: "#fff" }}
        >
          Add
        </button>
      </div>

      <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, overflow: "hidden" }}>
        {songs.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.7 }}>No songs yet.</div>
        ) : (
          songs.map((s, i) => (
            <div
              key={`${i}-${s?.title || ""}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: 12,
                borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <div style={{ fontWeight: 700 }}>{s?.title || "(untitled)"}</div>
              <button
                onClick={() => removeSong(i)}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", background: "#fff" }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.65 }}>
        Refresh test: add → refresh page → titles must remain.
      </div>
    </div>
  );
}
