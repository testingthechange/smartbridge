// FILE: src/minisite/catalog/Catalog.jsx
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  emptySong,
  getApiBase,
  uploadSongFile,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
} from "./catalogCore.js";

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

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const projectId = String(projectIdParam || "demo");

  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const token = qs.get("token") || "";
  const isAdmin = (qs.get("admin") || "").trim() === "1";

  // CHANGE: token page is editable (producer working page)
  const isProducerView = Boolean(token) && !isAdmin;

  // Read-only OFF for token view (producer must edit + master save)
  const readOnly = false;

  const [project, setProject] = useState(() =>
    ensureProject(loadProject(projectId), projectId)
  );

  const audioRef = useRef(null);

  const [playerErr, setPlayerErr] = useState("");
  const [nowSrc, setNowSrc] = useState("");
  const [nowLabel, setNowLabel] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const [uploadErr, setUploadErr] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");

  const [confirmStep, setConfirmStep] = useState(0);
  const [msStatus, setMsStatus] = useState("");

  const canUpload = !window.location.hostname.includes("smartbridge2.onrender.com");

  function persist(next) {
    saveProject(projectId, next);
    return next;
  }

  function updateSong(slot, updater) {
    if (readOnly) return;
    setProject((prev) => {
      const next = ensureProject(prev, projectId);
      next.catalog.songs = next.catalog.songs.map((s) =>
        Number(s.slot) === Number(slot) ? updater(s) : s
      );
      persist(next);
      return next;
    });
  }

  function setAndPlay(url, label) {
    if (!url) {
      setPlayerErr("No playback URL available.");
      return;
    }
    setPlayerErr("");
    setNowSrc(url);
    setNowLabel(label || "");

    const a = audioRef.current;
    if (!a) return;

    if (a.src !== url) a.src = url;
    a.currentTime = 0;

    a.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (!nowSrc) return;

    if (a.paused) {
      a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      a.pause();
      setIsPlaying(false);
    }
  }

  function seekTo(t) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(t || 0);
    setCur(a.currentTime);
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setCur(a.currentTime || 0);
    const onDur = () => setDur(a.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  async function onChooseFile(slot, vk, file) {
    if (readOnly) return;
    if (!file) return;

    setUploadErr("");
    const key = `song_${slot}_${vk}`;
    setUploadingKey(key);

    const localUrl = URL.createObjectURL(file);
    updateSong(slot, (x) => ({
      ...x,
      files: {
        ...(x.files || {}),
        [vk]: {
          ...(x.files?.[vk] || { fileName: "", s3Key: "", playbackUrl: "" }),
          fileName: file.name,
          playbackUrl: localUrl,
        },
      },
    }));

    if (!canUpload) {
      setUploadingKey("");
      return;
    }

    try {
      const apiBase = getApiBase();
      const res = await uploadSongFile({
        apiBase,
        projectId,
        slot,
        versionKey: vk,
        file,
        token,
      });

      const s3Key = String(res?.s3Key || "");
      const publicUrl = String(res?.publicUrl || "");

      updateSong(slot, (x) => ({
        ...x,
        files: {
          ...(x.files || {}),
          [vk]: {
            ...(x.files?.[vk] || {}),
            fileName: file.name,
            s3Key,
            playbackUrl: publicUrl || x.files?.[vk]?.playbackUrl || "",
          },
        },
      }));
    } catch (e) {
      setUploadErr(e?.message || "Upload failed.");
    } finally {
      setUploadingKey("");
    }
  }

  async function onMasterSave() {
    setMsStatus("Master saving…");
    setConfirmStep(0);

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
        persist(next);
        return next;
      });

      setMsStatus("Master Save complete.");
    } catch (e) {
      setMsStatus(e?.message || "Master Save failed.");
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "18px 0 140px", color: "#111" }}>
      <h2 style={{ marginBottom: 4 }}>Catalog</h2>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
        Project ID: <b>{projectId}</b>
        {isAdmin ? <span style={{ marginLeft: 8, opacity: 0.75 }}>(admin)</span> : null}
        {isProducerView ? <span style={{ marginLeft: 8, opacity: 0.75 }}>(producer)</span> : null}
      </div>

      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          background: "#f9f9f9",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={togglePlay} style={{ padding: "8px 12px" }} disabled={!nowSrc}>
            {isPlaying ? "Pause" : "Play"}
          </button>

          <div style={{ fontSize: 13, opacity: 0.9, minWidth: 240 }}>
            {nowLabel ? <b>{nowLabel}</b> : <span>Select a version Play below</span>}
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, minWidth: 80 }}>
            {fmtTime(cur)} / {dur ? fmtTime(dur) : "0:00"}
          </div>

          <input
            type="range"
            min={0}
            max={dur || 0}
            step="0.05"
            value={Math.min(cur, dur || 0)}
            onChange={(e) => seekTo(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
            disabled={!dur}
          />
        </div>

        {playerErr ? <div style={{ color: "red", fontSize: 12, marginTop: 8 }}>{playerErr}</div> : null}
      </div>

      <audio ref={audioRef} />

      {!canUpload && (
        <div
          style={{
            color: "#b00020",
            fontSize: 13,
            marginBottom: 14,
            background: "#fff3f3",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #f0b3b3",
          }}
        >
          Upload-to-S3 disabled on smartbridge2 (static site). Upload in publisher/admin backend.
        </div>
      )}

      {uploadErr ? <div style={{ color: "red", fontSize: 12, marginBottom: 10 }}>{uploadErr}</div> : null}

      {project.catalog.songs.map((s) => (
        <div
          key={s.slot}
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div style={{ width: 36, opacity: 0.7 }}>#{s.slot}</div>
            <input
              value={s.title || ""}
              onChange={(e) => updateSong(s.slot, (x) => ({ ...x, title: e.target.value }))}
              placeholder={`Song ${s.slot} title`}
              style={{
                width: "50%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #ccc",
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {["album", "a", "b"].map((vk) => {
              const f = s.files?.[vk] || { fileName: "", s3Key: "", playbackUrl: "" };
              const key = `song_${s.slot}_${vk}`;
              const isUp = uploadingKey === key;

              return (
                <div
                  key={vk}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 10,
                    padding: 10,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{vk.toUpperCase()}</div>

                  <input
                    type="file"
                    disabled={!canUpload || isUp}
                    onChange={(e) => onChooseFile(s.slot, vk, e.target.files?.[0] || null)}
                  />

                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    {f.fileName ? (
                      <div>
                        File: <b>{f.fileName}</b>
                      </div>
                    ) : (
                      <div style={{ opacity: 0.65 }}>No file chosen</div>
                    )}
                  </div>

                  <button
                    style={{ marginTop: 10 }}
                    onClick={() =>
                      setAndPlay(
                        f.playbackUrl,
                        `#${s.slot} ${vk.toUpperCase()}${s.title ? ` — ${s.title}` : ""}`
                      )
                    }
                    disabled={!f.playbackUrl || isUp}
                  >
                    {isUp ? "Uploading…" : `Play ${vk.toUpperCase()}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Master Save available on token page AND admin page */}
      <div
        style={{
          border: "1px solid rgba(0,0,0,0.18)",
          borderRadius: 12,
          padding: 12,
          background: "#ffffff",
          marginTop: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800 }}>Master Save</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Finalizes Catalog snapshot for this project.
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

        {msStatus ? <div style={{ marginTop: 10, fontSize: 12 }}>{msStatus}</div> : null}

        {project.producerReturnReceived ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "green" }}>
            Producer return received at {project.producerReturnReceivedAt}
          </div>
        ) : null}
      </div>
    </div>
  );
}
