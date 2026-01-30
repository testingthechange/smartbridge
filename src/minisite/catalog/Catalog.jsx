// FILE: src/minisite/catalog/Catalog.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  emptySong,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
  getApiBase,
  uploadSongFile,
  fetchPlaybackUrl,
  MAX_UPLOAD_MB,
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
    catalog: { songs },
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

  const [project, setProject] = useState(() =>
    ensureProject(loadProject(projectId), projectId)
  );

  const audioRef = useRef(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [playerErr, setPlayerErr] = useState("");

  const canUpload = !window.location.hostname.includes("smartbridge2.onrender.com");

  function updateSong(slot, updater) {
    setProject((prev) => {
      const next = ensureProject(prev, projectId);
      next.catalog.songs = next.catalog.songs.map((s) =>
        Number(s.slot) === Number(slot) ? updater(s) : s
      );
      saveProject(projectId, next);
      return next;
    });
  }

  function play(url) {
    if (!url) {
      setPlayerErr("No playback URL.");
      return;
    }
    setPlayerErr("");
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", paddingBottom: 100 }}>
      <h2>Catalog</h2>

      {!canUpload && (
        <div style={{ color: "red", fontSize: 12, marginBottom: 12 }}>
          upload-to-s3 disabled on smartbridge2 (static site). Upload in publisher/admin backend.
        </div>
      )}

      {project.catalog.songs.map((s) => (
        <div
          key={s.slot}
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <div style={{ width: 40 }}>#{s.slot}</div>
            <input
              value={s.title || ""}
              onChange={(e) =>
                updateSong(s.slot, (x) => ({ ...x, title: e.target.value }))
              }
              placeholder={`Song ${s.slot} title`}
              style={{ flex: 1, padding: 8 }}
            />
            <button onClick={() => play(s.files.album.playbackUrl)}>Play</button>
          </div>

          {/* THREE-COLUMN VERSION LAYOUT */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            {["album", "a", "b"].map((vk) => {
              const f = s.files[vk];
              const r = s.uploadRequests[vk];

              return (
                <div
                  key={vk}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {vk.toUpperCase()}
                  </div>

                  <input
                    type="file"
                    disabled={!canUpload}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const localUrl = URL.createObjectURL(file);

                      updateSong(s.slot, (x) => ({
                        ...x,
                        files: {
                          ...x.files,
                          [vk]: {
                            ...x.files[vk],
                            fileName: file.name,
                            playbackUrl: localUrl,
                          },
                        },
                      }));

                      if (canUpload) {
                        uploadSongFile({
                          apiBase: getApiBase(),
                          projectId,
                          slot: s.slot,
                          versionKey: vk,
                          file,
                          token,
                        }).catch(() => {});
                      }
                    }}
                  />

                  <input
                    value={r.requestedFileName}
                    onChange={(e) =>
                      updateSong(s.slot, (x) => ({
                        ...x,
                        uploadRequests: {
                          ...x.uploadRequests,
                          [vk]: { ...r, requestedFileName: e.target.value },
                        },
                      }))
                    }
                    placeholder="Request upload file name"
                    style={{ width: "100%", marginTop: 6 }}
                  />

                  <input
                    value={r.notes}
                    onChange={(e) =>
                      updateSong(s.slot, (x) => ({
                        ...x,
                        uploadRequests: {
                          ...x.uploadRequests,
                          [vk]: { ...r, notes: e.target.value },
                        },
                      }))
                    }
                    placeholder="Notes for admin (optional)"
                    style={{ width: "100%", marginTop: 6 }}
                  />

                  {f.playbackUrl && (
                    <button
                      style={{ marginTop: 8 }}
                      onClick={() => play(f.playbackUrl)}
                    >
                      Play {vk.toUpperCase()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <audio ref={audioRef} controls style={{ width: "100%", marginTop: 20 }} />
      {playerErr && <div style={{ color: "red", marginTop: 6 }}>{playerErr}</div>}
    </div>
  );
}
