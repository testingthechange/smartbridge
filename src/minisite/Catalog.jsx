// FILE: src/minisite/Catalog.jsx
// FIXED: catalog state persists on refresh (no reset loop)
// - Reads project from ProjectMiniSiteContext
// - Writes changes via setSection (single source of truth)
// - No local component-only state for catalog data

import React, { useMemo, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useProjectMiniSite } from "../ProjectMiniSiteContext.jsx";

export default function Catalog() {
  const { projectId } = useParams();
  const qs = new URLSearchParams(useLocation().search || "");
  const token = qs.get("token") || "";

  const { project, setSection } = useProjectMiniSite();
  const pid = String(projectId || "").trim();

  // canonical catalog from project (PERSISTED)
  const catalog = project?.catalog || {};
  const songs = useMemo(
    () => (Array.isArray(catalog.songs) ? catalog.songs : []),
    [catalog.songs]
  );

  // local draft only (safe to reset)
  const [titleDraft, setTitleDraft] = useState("");

  function addSong() {
    const title = titleDraft.trim();
    if (!title) return;

    const nextSongs = [
      ...songs,
      {
        id: crypto.randomUUID(),
        title,
        createdAt: new Date().toISOString(),
      },
    ];

    // 🔒 SINGLE WRITE PATH (persists to storage)
    setSection(pid, "catalog", {
      ...catalog,
      songs: nextSongs,
    });

    setTitleDraft("");
  }

  function removeSong(id) {
    const nextSongs = songs.filter((s) => s.id !== id);

    // 🔒 SINGLE WRITE PATH
    setSection(pid, "catalog", {
      ...catalog,
      songs: nextSongs,
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          padding: 12,
          border: "2px solid #16a34a",
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 900 }}>CATALOG — FIXED PERSISTENCE</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          projectId: <b>{pid}</b> • token:{" "}
          <span style={{ fontFamily: "monospace" }}>{token || "—"}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Add song title"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.18)",
          }}
        />
        <button
          onClick={addSong}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.18)",
            background: "#fff",
            fontWeight: 800,
          }}
        >
          Add
        </button>
      </div>

      <div
        style={{
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {songs.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.7 }}>No songs yet.</div>
        ) : (
          songs.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: 12,
                borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <div style={{ fontWeight: 800 }}>{s.title}</div>
              <button
                onClick={() => removeSong(s.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.18)",
                  background: "#fff",
                }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
