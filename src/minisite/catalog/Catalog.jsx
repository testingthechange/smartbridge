// FILE: src/minisite/catalog/Catalog.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  emptySong,
  getApiBase,
  // uploadSongFile, // minisite is playback-only (static site)
  fetchPlaybackUrl,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
} from "./catalogCore.js";

/**
 * smartbridge2 minisite = PLAYBACK ONLY.
 * - NEVER create blob: URLs
 * - NEVER persist playbackUrl
 * - Play is ALWAYS resolved via s3Key -> backend -> signed URL
 */

function normalizeSong(rawSong, slot) {
  const seed = emptySong(slot);
  const s = rawSong && typeof rawSong === "object" ? rawSong : {};

  const rawFiles = s.files && typeof s.files === "object" ? s.files : {};
  const seedFiles = seed.files || {};

  const normalizeFileObj = (obj, fallback) => {
    const o = obj && typeof obj === "object" ? obj : {};
    return {
      fileName: String(o.fileName || fallback?.fileName || ""),
      s3Key: String(o.s3Key || fallback?.s3Key || ""),
      playbackUrl: "", // NEVER persisted
    };
  };

  return {
    ...seed,
    ...s,
    slot: Number(s.slot ?? slot),
    title: String(s.title || ""),
    titleJson:
      s.titleJson && typeof s.titleJson === "object"
        ? {
            slot: Number(s.titleJson.slot ?? (s.slot ?? slot)),
            title: String(s.titleJson.title ?? s.title ?? ""),
            updatedAt: String(s.titleJson.updatedAt || ""),
            source: String(s.titleJson.source || "catalog"),
          }
        : seed.titleJson,
    files: {
      album: normalizeFileObj(rawFiles.album, seedFiles.album),
      a: normalizeFileObj(rawFiles.a, seedFiles.a),
      b: normalizeFileObj(rawFiles.b, seedFiles.b),
    },
  };
}

function ensureProject(project, projectId) {
  const base = project && typeof project === "object" ? project : {};
  const songsRaw = Array.isArray(base?.catalog?.songs) ? base.catalog.songs : [];

  const songs = Array.from({ length: 9 }, (_, i) => {
    const slot = i + 1;
    const found = songsRaw.find((x) => Number(x?.slot) === slot) ?? songsRaw[i] ?? null;
    return normalizeSong(found, slot);
  });

  return {
    projectId: String(base.projectId || projectId),
    catalog: { ...(base.catalog || {}), songs },
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

function hardResetAudio(a) {
  if (!a) return;
  try {
    a.pause();
  } catch {}
  try {
    a.removeAttribute("src");
    a.load();
  } catch {}
  try {
    a.currentTime = 0;
  } catch {}
}

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const projectId = String(projectIdParam || "demo");

  const { search } = useLocation();
  const qs = useMemo(() => new URLSearchParams(search), [search]);
  const token = qs.get("token") || "";
  const isAdmin = String(qs.get("admin") || "").trim() === "1";
  const isProducerView = Boolean(token) && !isAdmin;

  // Minisite playback-only: no upload anywhere here
  const IS_STATIC_MINISITE = true;

  // Producer can edit titles + master save (if you want). Admin read-only.
  const readOnly = Boolean(isAdmin);

  const [project, setProject] = useState(() =>
    ensureProject(loadProject(projectId), projectId)
  );

  // One-time self-heal: normalize + persist (wipes any old playbackUrl fields)
  useEffect(() => {
    setProject((prev) => {
      const healed = ensureProject(prev, projectId);
      saveProject(projectId, healed);
      return healed;
    });
  }, [projectId]);

  // Player
  const audioRef = useRef(null);
  const [playerErr, setPlayerErr] = useState("");
  const [nowLabel, setNowLabel] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  // IMPORTANT: resolve URL cache (in-memory only)
  const playbackCacheRef = useRef(new Map()); // s3Key -> { url, cachedAt }
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min (shorter to avoid expired signed URLs)

  // Upload UI disabled
  const [uploadErr] = useState(
    IS_STATIC_MINISITE
      ? "upload-to-s3 disabled on smartbridge2 (static site). Upload in publisher/admin backend."
      : ""
  );

  // Master Save confirm
  const [confirmStep, setConfirmStep] = useState(0);
  const [msStatus, setMsStatus] = useState("");
  const [msSuccessAt, setMsSuccessAt] = useState("");

  function persist(next) {
    saveProject(projectId, next);
    return next;
  }

  function updateSong(slot, updater) {
    if (readOnly) return;
    setProject((prev) => {
      const next = ensureProject(prev, projectId);
      next.catalog.songs = next.catalog.songs.map((s) =>
        Number(s.slot) === Number(slot)
          ? normalizeSong(updater(s), Number(slot))
          : s
      );
      persist(next);
      return next;
    });
  }

  // Hard reset audio on mount/unmount (prevents stale browser media state after navigation)
  useEffect(() => {
    hardResetAudio(audioRef.current);
    setPlayerErr("");
    setNowLabel("");
    setIsPlaying(false);
    setCur(0);
    setDur(0);

    return () => {
      hardResetAudio(audioRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function resolvePlaybackUrl(s3Key) {
    const key = String(s3Key || "");
    if (!key) return "";

    const cached = playbackCacheRef.current.get(key);
    if (cached?.url && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.url;
    }

    const apiBase = getApiBase();
    const url = await fetchPlaybackUrl({ apiBase, s3Key: key, token });
    const clean = String(url || "");

    if (clean) {
      playbackCacheRef.current.set(key, { url: clean, cachedAt: Date.now() });
    }
    return clean;
  }

  async function playUrl(url, label) {
    const u = String(url || "");
    if (!u) {
      setPlayerErr("No playback URL available.");
      return;
    }

    const a = audioRef.current;
    if (!a) return;

    setPlayerErr("");
    setNowLabel(label || "");

    try {
      // Hard reset before switching sources (prevents internal stuck state)
      hardResetAudio(a);

      a.muted = false;
      if (typeof a.volume === "number") a.volume = 1;

      a.src = u;
      a.load();

      // Force metadata read
      a.currentTime = 0;

      await a.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setPlayerErr("Playback blocked or audio failed. Click the version Play button again.");
    }
  }

  async function playVersion(slot, vk) {
    const song = project?.catalog?.songs?.find(
      (x) => Number(x?.slot) === Number(slot)
    );
    const f = song?.files?.[vk] || { fileName: "", s3Key: "", playbackUrl: "" };

    const label = `#${slot} ${String(vk).toUpperCase()}${
      song?.title ? ` — ${song.title}` : ""
    }`;

    const s3Key = String(f.s3Key || "");
    if (!s3Key) {
      setPlayerErr("No uploaded file yet (missing s3Key).");
      return;
    }

    try {
      const url = await resolvePlaybackUrl(s3Key);
      if (!url) {
        setPlayerErr("Backend returned no playback URL.");
        return;
      }
      await playUrl(url, label);
    } catch (e) {
      setPlayerErr(e?.message || "Failed to resolve playback URL.");
    }
  }

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (!a.src) return;

    try {
      if (a.paused) {
        await a.play();
        setIsPlaying(true);
      } else {
        a.pause();
        setIsPlaying(false);
      }
    } catch {
      setIsPlaying(false);
      setPlayerErr("Playback blocked. Click a version Play button again.");
    }
  }

  function seekTo(t) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(t || 0);
    setCur(a.currentTime);
  }

  // Keep ONLY minimal listeners; avoid timeupdate render storms
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    let raf = 0;
    const tick = () => {
      // Only update while playing; avoids constant rerenders when paused
      if (!a.paused) {
        setCur(a.currentTime || 0);
        setDur(Number.isFinite(a.duration) ? a.duration : 0);
      }
      raf = window.requestAnimationFrame(tick);
    };

    const onPlay = () => {
      setIsPlaying(true);
      if (!raf) raf = window.requestAnimationFrame(tick);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () =>
      setPlayerErr("Audio failed to load (bad URL or blocked content-type).");

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;

      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);

      // hard reset on cleanup
      hardResetAudio(a);
    };
  }, []);

  async function onMasterSaveConfirm() {
    if (readOnly) return;

    setMsStatus("Master saving…");
    setMsSuccessAt("");

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

      setConfirmStep(0);
      setMsStatus("✅ Congrats! You have successfully Master Saved this page.");
      setMsSuccessAt(now);
    } catch (e) {
      setConfirmStep(0);
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

      {/* Player */}
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
          <button onClick={togglePlay} style={{ padding: "8px 12px" }} disabled={!audioRef.current?.src}>
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
              disabled={readOnly}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {["album", "a", "b"].map((vk) => {
              const f = s.files?.[vk] || { fileName: "", s3Key: "", playbackUrl: "" };

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
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{String(vk).toUpperCase()}</div>

                  {/* Upload UI disabled on minisite */}
                  <button type="button" disabled style={{ padding: "8px 10px", opacity: 0.55 }}>
                    Choose File (disabled)
                  </button>

                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    {f.fileName ? (
                      <div>
                        File: <b>{f.fileName}</b>
                      </div>
                    ) : (
                      <div style={{ opacity: 0.65 }}>No file (upload in admin backend)</div>
                    )}

                    {f.s3Key ? (
                      <div style={{ marginTop: 4, opacity: 0.65, wordBreak: "break-word" }}>s3Key: {f.s3Key}</div>
                    ) : null}
                  </div>

                  <button style={{ marginTop: 10 }} onClick={() => playVersion(s.slot, vk)} disabled={!f.s3Key}>
                    {`Play ${String(vk).toUpperCase()}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Master Save */}
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
            <div style={{ fontSize: 12, opacity: 0.75 }}>Finalizes Catalog snapshot for this project.</div>
          </div>

          {readOnly ? (
            <div style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>Admin is read-only.</div>
          ) : confirmStep === 0 ? (
            <button onClick={() => setConfirmStep(1)}>Master Save…</button>
          ) : null}
        </div>

        {!readOnly && confirmStep === 1 ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "rgba(255, 244, 229, 0.6)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Are you sure you want to Master Save this page?</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>This will create a finalized snapshot for Catalog.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmStep(0)}>Cancel</button>
              <button onClick={() => setConfirmStep(2)} style={{ border: "1px solid rgba(0,0,0,0.25)" }}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {!readOnly && confirmStep === 2 ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(176,0,32,0.25)",
              background: "rgba(255, 235, 238, 0.75)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Last chance. Better double-check everything.</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
              Please confirm titles and uploads. This snapshot is treated as final.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmStep(1)}>Back</button>
              <button onClick={onMasterSaveConfirm} style={{ border: "1px solid #b00020" }}>
                Confirm Master Save
              </button>
            </div>
          </div>
        ) : null}

        {msStatus ? (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            {msStatus}
            {msSuccessAt ? <span style={{ marginLeft: 8, opacity: 0.75 }}>({msSuccessAt})</span> : null}
          </div>
        ) : null}

        {project.producerReturnReceived ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "green" }}>
            Producer return received at {project.producerReturnReceivedAt}
          </div>
        ) : null}
      </div>
    </div>
  );
}
