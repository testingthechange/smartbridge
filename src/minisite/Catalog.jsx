// FILE: src/minisite/Catalog.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ensureProject, loadProject, setSection } from "./catalogCore.js";

export default function Catalog() {
  const { projectId } = useParams();
  const qs = new URLSearchParams(useLocation().search || "");
  const token = qs.get("token") || "";

  const pid = String(projectId || "").trim();

  const [project, setProject] = useState(() => (pid ? loadProject(pid) : null));
  const catalog = project?.catalog || {};
  const songs = useMemo(() => (Array.isArray(catalog?.songs) ? catalog.songs : []), [catalog]);

  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    if (!pid) return;
    ensureProject(pid);
    setProject(loadProject(pid));
  }, [pid]);

  function refresh() {
    setProject(loadProject(pid));
  }

  function addSong() {
    const t = String(titleDraft || "").trim();
    if (!t || !pid) return;

    const nextSongs = [
      ...songs,
      {
        slot: songs.length + 1,
        title: t,
        createdAt: new Date().toISOString(),
      },
    ];

    setSection(pid, "catalog", { ...catalog, songs: nextSongs });
    setTitleDraft("");
    refresh();
  }

  function removeSong(idx) {
    if (!pid) return;
    const nextSongs = songs.filter((_, i) => i !== idx);
    setSection(pid, "catalog", { ...catalog, songs: nextSongs });
    refresh();
  }

  return (
    <div style={{ padding: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12 }}>
      <div style={{ fontWeight: 900 }}>Catalog (localStorage)</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
        projectId: <b>{pid || "—"}</b> • token: <span style={{ fontFamily: "monospace" }}>{token || "—"}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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

      <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, overflow: "hidden", marginTop: 12 }}>
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

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6, fontFamily: "monospace" }}>
        storage key: project_{pid}
      </div>
    </div>
  );
}
