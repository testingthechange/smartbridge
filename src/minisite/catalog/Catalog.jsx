// FILE: src/minisite/catalog/Catalog.jsx
import React, { useMemo, useRef, useState } from "react";
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
    ? songsRaw.map((s, idx) => {
        const slot = Number(s?.slot ?? idx + 1);
        const files = s?.files && typeof s.files === "object" ? s.files : {};
        const uploadRequests =
          s?.uploadRequests && typeof s.uploadRequests === "object"
            ? s.uploadRequests
            : emptySong(slot).uploadRequests;

        return {
          ...emptySong(slot),
          ...s,
          slot,
          title: String(s?.title || ""),
          files: {
            album: { fileName: "", s3Key: "", playbackUrl: "", ...(files.album || {}) },
            a: { fileName: "", s3Key: "", playbackUrl: "", ...(files.a || {}) },
            b: { fileName: "", s3Key: "", playbackUrl: "", ...(files.b || {}) },
          },
          uploadRequests: {
            album: {
              requestedFileName: String(uploadRequests?.album?.requestedFileName || ""),
              notes: String(uploadRequests?.album?.notes || ""),
            },
            a: {
              requestedFileName: String(uploadRequests?.a?.requestedFileName || ""),
              notes: String(uploadRequests?.a?.notes || ""),
            },
            b: {
              requestedFileName: String(uploadRequests?.b?.requestedFileName || ""),
              notes: String(uploadRequests?.b?.notes || ""),
            },
          },
        };
      })
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

function bestPlayableUrl(song) {
  const f = song?.files || {};
  return (
    String(f?.album?.playbackUrl || "") ||
    String(f?.a?.playbackUrl || "") ||
    String(f?.b?.playbackUrl || "")
  );
}

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const query = useQuery();

  const projectId = String(projectIdParam || "demo");
  const token = String(query.get("token") || "").trim();

  const [project, setProject] = useState(() =>
    ensureProject(loadProject(projectId), projectId)
  );

  const [confirmStep, setConfirmStep] = useState(0);
  const [status, setStatus] = useState("");

  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Bottom player
  const audioRef = useRef(null);
  const [nowPlaying, setNowPlaying] = useState({
    slot: null,
    version: "",
    title: "",
    url: "",
  });

  const canUpload = !String(window.location.hostname || "").includes("smartbridge2.onrender.com");

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

  function updateUploadRequest(slot, versionKey, field, value) {
    setProject((prev) => {
      const next = ensureProject(prev, projectId);
      next.catalog.songs = next.catalog.songs.map((s) => {
        if (Number(s.slot) !== Number(slot)) return s;
        const ur = s.uploadRequests || emptySong(slot).uploadRequests;
        return {
          ...s,
          uploadRequests: {
            ...ur,
            [versionKey]: {
              ...(ur[versionKey] || {}),
              [field]: String(value || ""),
            },
          },
        };
      });
      saveProject(projectId, next);
      return next;
    });
  }

  function playSong(song, preferredVersion = "") {
    const f = song?.files || {};
    const url =
      (preferredVersion && String(f?.[preferredVersion]?.playbackUrl || "")) ||
      bestPlayableUrl(song);

    if (!url) return;

    const title = String(song?.title || `Song ${song?.slot || ""}`).trim();
    setNowPlaying({
      slot: Number(song?.slot || 0),
      version: preferredVersion || "",
      title,
      url,
    });

    const el = audioRef.current;
    if (el) {
      el.src = url;
      el.play().catch(() => {});
    }
  }

  async function onUpload(slot, versionKey, file) {
    setUploadErr("");
    if (!file) return;

    const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadErr(`File too large. Max ${MAX_UPLOAD_MB}MB.`);
      return;
    }

    const apiBase = getApiBase();
    const key = `${slot}:${versionKey}`;
    setUploadingKey(key);

    try {
      const up = await uploadSongFile({
        apiBase,
        projectId,
        slot,
        versionKey,
        file,
        token,
      });

      const s3Key = String(up?.s3Key || "");
      const playbackUrl = s3Key
        ? await fetchPlaybackUrl({ apiBase, s3Key, token })
        : "";

      setProject((prev) => {
        const next = ensureProject(prev, projectId);
        next.catalog.songs = next.catalog.songs.map((s) => {
          if (Number(s.slot) !== Number(slot)) return s;

          const files = s.files || {};
          const existing = files[versionKey] || {
            fileName: "",
            s3Key: "",
            playbackUrl: "",
          };

          return {
            ...s,
            files: {
              ...files,
              [versionKey]: {
                ...existing,
                fileName: file.name,
                s3Key,
                playbackUrl,
              },
            },
          };
        });

        saveProject(projectId, next);
        return next;
      });
    } catch (e) {
      setUploadErr(e?.message || "Upload failed.");
    } finally {
      setUploadingKey("");
    }
  }

  async function refreshPlaybackUrls() {
    setUploadErr("");
    setRefreshing(true);
    try {
      const apiBase = getApiBase();

      const updates = [];
      for (const s of project.catalog.songs) {
        for (const vk of ["album", "a", "b"]) {
          const s3Key = String(s?.files?.[vk]?.s3Key || "");
          if (!s3Key) continue;
          updates.push({ slot: Number(s.slot), vk, s3Key });
        }
      }

      if (!updates.length) {
        setRefreshing(false);
        return;
      }

      const urlMap = new Map();
      for (const u of updates) {
        const url = await fetchPlaybackUrl({ apiBase, s3Key: u.s3Key, token });
        urlMap.set(`${u.slot}:${u.vk}`, String(url || ""));
      }

      setProject((prev) => {
        const next = ensureProject(prev, projectId);
        next.catalog.songs = next.catalog.songs.map((s) => {
          const files = s.files || {};
          const out = { ...s, files: { ...files } };
          for (const vk of ["album", "a", "b"]) {
            const key = `${Number(s.slot)}:${vk}`;
            if (!urlMap.has(key)) continue;
            out.files[vk] = { ...(out.files[vk] || {}), playbackUrl: urlMap.get(key) || "" };
          }
          return out;
        });
        saveProject(projectId, next);
        return next;
      });
    } catch (e) {
      setUploadErr(e?.message || "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
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
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "16px 0 92px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 10, marginBottom: 10 }}>Catalog</h2>

        <button
          onClick={refreshPlaybackUrls}
          disabled={refreshing}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.2)",
            background: "rgba(255,255,255,0.06)",
            cursor: refreshing ? "not-allowed" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh playback URLs"}
        </button>
      </div>

      {!canUpload ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,77,79,0.45)",
            background: "rgba(255,77,79,0.10)",
            fontSize: 12,
          }}
        >
          Uploads are disabled on smartbridge2 (static site). Upload in publisher/admin backend.
          Use “Request Upload” fields below to tell admin what you uploaded. This page can still
          preview existing playback URLs and submit Master Save.
        </div>
      ) : null}

      {uploadErr ? (
        <div style={{ marginBottom: 10, color: "#ff4d4f", fontSize: 12 }}>{uploadErr}</div>
      ) : null}

      <div
        style={{
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 12,
          padding: 12,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {project.catalog.songs.map((s) => (
          <div
            key={s.slot}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 44, opacity: 0.7 }}>#{s.slot}</div>

              <input
                value={s.title || ""}
                onChange={(e) => updateSongTitle(s.slot, e.target.value)}
                placeholder={`Song ${s.slot} title`}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                }}
              />

              <button
                onClick={() => playSong(s)}
                disabled={!bestPlayableUrl(s)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.2)",
                  background: "rgba(255,255,255,0.06)",
                  cursor: bestPlayableUrl(s) ? "pointer" : "not-allowed",
                  opacity: bestPlayableUrl(s) ? 1 : 0.5,
                }}
              >
                Play
              </button>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              {["album", "a", "b"].map((vk) => {
                const isUploading = uploadingKey === `${s.slot}:${vk}`;
                const f = (s.files && s.files[vk]) || {};
                const hasPlayable = Boolean(f.playbackUrl);
                const req = (s.uploadRequests && s.uploadRequests[vk]) || {
                  requestedFileName: "",
                  notes: "",
                };

                return (
                  <div
                    key={vk}
                    style={{
                      width: "100%",
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 12,
                      padding: 10,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        <b>{vk.toUpperCase()}</b>{" "}
                        {f.s3Key ? <span style={{ marginLeft: 8, opacity: 0.7 }}>s3Key set</span> : null}
                        {hasPlayable ? <span style={{ marginLeft: 8, color: "#44d18a" }}>preview ready</span> : null}
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {hasPlayable ? (
                          <button
                            onClick={() => playSong(s, vk)}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid rgba(0,0,0,0.2)",
                              background: "rgba(255,255,255,0.06)",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            Play {vk.toUpperCase()}
                          </button>
                        ) : null}

                        <input
                          type="file"
                          accept="audio/*"
                          disabled={!canUpload || isUploading}
                          onChange={(e) => onUpload(s.slot, vk, e.target.files?.[0] || null)}
                        />

                        {isUploading ? (
                          <span style={{ fontSize: 12, opacity: 0.8 }}>Uploading…</span>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 10 }}>
                      <input
                        value={req.requestedFileName || ""}
                        onChange={(e) => updateUploadRequest(s.slot, vk, "requestedFileName", e.target.value)}
                        placeholder={`Request Upload: file name you uploaded for ${vk.toUpperCase()} (e.g., Song${s.slot}_${vk}.wav)`}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.2)",
                        }}
                      />
                      <input
                        value={req.notes || ""}
                        onChange={(e) => updateUploadRequest(s.slot, vk, "notes", e.target.value)}
                        placeholder={`Notes for admin (optional)`}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.2)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 12,
          padding: 12,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Master Save</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
              Finalizes Catalog snapshot (includes upload requests + notes).
            </div>
            <div style={{ fontSize: 12, color: "#ff4d4f", marginTop: 6 }}>
              Use intentionally. This is treated as a finalized submission.
            </div>
          </div>

          {confirmStep === 0 ? (
            <button
              onClick={() => setConfirmStep(1)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                background: "rgba(255,255,255,0.06)",
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
                  border: "1px solid rgba(0,0,0,0.2)",
                  background: "rgba(255,255,255,0.06)",
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
                  border: "1px solid rgba(255,77,79,0.6)",
                  background: "rgba(255,77,79,0.14)",
                  cursor: "pointer",
                }}
              >
                Confirm Master Save
              </button>
            </div>
          )}
        </div>

        {status ? <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>{status}</div> : null}
      </div>

      {project.producerReturnReceived ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#44d18a" }}>
          Producer return received at {project.producerReturnReceivedAt}
        </div>
      ) : null}

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          borderTop: "1px solid rgba(0,0,0,0.15)",
          background: "rgba(16,24,36,0.92)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {nowPlaying.url ? (
              <>
                Now Playing: <b>#{nowPlaying.slot}</b> {nowPlaying.title}
                {nowPlaying.version ? ` (${String(nowPlaying.version).toUpperCase()})` : ""}
              </>
            ) : (
              "Player: select Play on any song"
            )}
          </div>

          <audio ref={audioRef} controls style={{ height: 34, minWidth: 280 }} />
        </div>
      </div>
    </div>
  );
}
