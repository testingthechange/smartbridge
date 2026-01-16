// src/minisite/Catalog.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";

import {
  MAX_UPLOAD_MB,
  VERSION_KEYS,
  loadProject,
  saveProject,
  emptySong,
  ensureSongTitleJson,
  clamp,
  fmtTime,
  once,
  uploadSongFile,
  fetchPlaybackUrl,
  buildSnapshot,
  projectForBackendFromSnapshot,
  postMasterSave,
} from "./catalog/catalogCore.js";

/** ✅ prevents “stuck loading forever” */
function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

/** ✅ detect expired/invalid presigned URL */
function isExpiredPresignError(err) {
  const s = String(err?.message || err || "").toLowerCase();
  return (
    s.includes("403") ||
    s.includes("forbidden") ||
    s.includes("expired") ||
    s.includes("signature") ||
    s.includes("accessdenied")
  );
}

/** ✅ NEW: compute audio duration from the local file (no network) */
async function getAudioDurationSecFromFile(file) {
  if (!file) return 0;
  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = url;

    await new Promise((resolve, reject) => {
      const onLoaded = () => resolve();
      const onErr = () => reject(new Error("Failed to read audio duration"));
      a.addEventListener("loadedmetadata", onLoaded, { once: true });
      a.addEventListener("error", onErr, { once: true });
    });

    const d = Number(a.duration);
    return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PlayingEq({ active }) {
  return (
    <span
      aria-label={active ? "Playing" : "Not playing"}
      title={active ? "Playing" : ""}
      style={{
        display: "inline-flex",
        gap: 2,
        alignItems: "flex-end",
        height: 12,
        width: 16,
        opacity: active ? 1 : 0,
        transform: active ? "scale(1)" : "scale(0.9)",
        transition: "opacity 120ms ease, transform 120ms ease",
      }}
    >
      <span style={eqBarBase(active)} className={active ? "eq1" : ""} />
      <span style={eqBarBase(active)} className={active ? "eq2" : ""} />
      <span style={eqBarBase(active)} className={active ? "eq3" : ""} />
    </span>
  );
}

function eqBarBase(active) {
  return {
    display: "inline-block",
    width: 3,
    borderRadius: 2,
    background: active ? "#111827" : "transparent",
    height: active ? 6 : 0,
    transformOrigin: "bottom",
  };
}

export default function Catalog() {
  const params = useParams();
  const location = useLocation();

  const projectId = useMemo(() => {
    const fromParams = (params?.projectId || "").trim();
    if (fromParams) return fromParams;
    const sp = new URLSearchParams(location.search || "");
    return (sp.get("projectId") || "").trim();
  }, [params, location.search]);

  // ✅ CLEAN: single source of truth, no fallback
  const API_BASE = useMemo(() => {
    return String(import.meta.env.VITE_API_BASE || "")
      .trim()
      .replace(/\/+$/, "");
  }, []);

  const [project, setProject] = useState(() => loadProject(projectId));

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [loadingKey, setLoadingKey] = useState(""); // "3:a" or "3:a:upload"

  const [activeTrack, setActiveTrack] = useState(null); // {slot, versionKey}
  const [isPlaying, setIsPlaying] = useState(false);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  const [masterSaveLastAt, setMasterSaveLastAt] = useState("");
  const [masterSaveSnapshotKey, setMasterSaveSnapshotKey] = useState("");

  const audioRef = useRef(null);
  const playSeq = useRef(0);

  /* ---------- init ---------- */

  useEffect(() => {
    if (!projectId) return;

    const base =
      loadProject(projectId) || {
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        catalog: { songs: [] },
        album: {},
        nftMix: {},
        songs: {},
        meta: {},
        masterSave: {
          lastMasterSaveAt: "",
          sections: {
            catalog: { complete: false, masterSavedAt: "" },
          },
        },
      };

    const existing = Array.isArray(base?.catalog?.songs) ? base.catalog.songs : [];
    const ensured = [];
    for (let i = 1; i <= 9; i++) {
      const found = existing.find((s) => Number(s?.slot) === i);
      const merged = found ? { ...emptySong(i), ...found } : emptySong(i);

      if (!merged.titleJson || typeof merged.titleJson !== "object") {
        merged.titleJson = ensureSongTitleJson(i, merged.title || "");
      } else {
        merged.titleJson = {
          slot: Number(merged.titleJson.slot ?? i),
          title: String(merged.titleJson.title ?? merged.title ?? ""),
          updatedAt: String(merged.titleJson.updatedAt || ""),
          source: String(merged.titleJson.source || "catalog"),
        };
      }

      ensured.push(merged);
    }

    base.catalog = { ...(base.catalog || {}), songs: ensured };

    saveProject(projectId, base);
    setProject(base);
  }, [projectId]);

  function updateProject(fn) {
    setProject((prev) => {
      const next = fn(prev || {});
      next.updatedAt = new Date().toISOString();
      saveProject(projectId, next);
      return next;
    });
  }

  function updateSong(slot, patchOrFn) {
    updateProject((prev) => {
      const prevSongs = Array.isArray(prev?.catalog?.songs) ? prev.catalog.songs : [];
      const nextSongs = prevSongs.map((s) => {
        if (Number(s.slot) !== Number(slot)) return s;
        const patch = typeof patchOrFn === "function" ? patchOrFn(s) : patchOrFn;
        return { ...s, ...patch };
      });
      return {
        ...prev,
        catalog: { ...(prev.catalog || {}), songs: nextSongs },
      };
    });
  }

  const songs = project?.catalog?.songs || [];

  function sameTrack(a, b) {
    return (
      a &&
      b &&
      Number(a.slot) === Number(b.slot) &&
      String(a.versionKey) === String(b.versionKey)
    );
  }

  /* ---------- audio events ---------- */

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    const onLoaded = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => {
      if (!isSeeking) setCurrentTime(a.currentTime || 0);
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
    };
  }, [isSeeking]);

  async function playTrack(slot, versionKey) {
    setErr("");
    const seq = ++playSeq.current;

    if (!API_BASE) {
      setErr(
        "Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.\n" +
          "Example: VITE_API_BASE=https://album-backend-kmuo.onrender.com"
      );
      return;
    }

    const songNow = songs.find((s) => Number(s.slot) === Number(slot));
    const fileNow = songNow?.files?.[versionKey];
    const s3Key = fileNow?.s3Key || "";
    if (!s3Key) return;

    setLoadingKey(`${slot}:${versionKey}`);
    setBusy("Loading…");

    try {
      // ✅ Always request a fresh presigned URL (they expire)
      const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });

      updateSong(slot, (s) => ({
        files: {
          ...(s.files || {}),
          [versionKey]: { ...(s.files?.[versionKey] || {}), playbackUrl: url },
        },
      }));

      setBusy("");

      if (seq !== playSeq.current) return;

      const a = audioRef.current;
      if (!a) return;

      setActiveTrack({ slot, versionKey });

      const setSrcAndPlay = async (u) => {
        if (a.src !== u) {
          try {
            a.pause();
          } catch {}
          a.currentTime = 0;
          setCurrentTime(0);
          setDuration(0);

          a.src = u;
          a.load();

          await Promise.race([once(a, "canplay"), once(a, "loadedmetadata")]);
          if (seq !== playSeq.current) return;
        }

        await a.play();
      };

      try {
        await setSrcAndPlay(url);
      } catch (e) {
        // ✅ If it 403s (expired), refresh once and retry
        if (isExpiredPresignError(e)) {
          const fresh = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
          updateSong(slot, (s) => ({
            files: {
              ...(s.files || {}),
              [versionKey]: { ...(s.files?.[versionKey] || {}), playbackUrl: fresh },
            },
          }));
          await setSrcAndPlay(fresh);
        } else {
          throw e;
        }
      }
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Playback failed");
    } finally {
      setLoadingKey("");
    }
  }

  function togglePlay(slot, versionKey) {
    const a = audioRef.current;
    if (!a) return;

    if (sameTrack(activeTrack, { slot, versionKey })) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
    } else {
      playTrack(slot, versionKey);
    }
  }

  /* ---------- upload ---------- */

  async function onUpload(slot, versionKey, file) {
    if (!file) return;
    setErr("");

    if (!API_BASE) {
      setErr(
        "Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.\n" +
          "Example: VITE_API_BASE=https://album-backend-kmuo.onrender.com"
      );
      return;
    }

    const mb = file.size / (1024 * 1024);
    if (mb > MAX_UPLOAD_MB) {
      setErr(`File too large (${mb.toFixed(1)}MB). Max is ${MAX_UPLOAD_MB}MB.`);
      return;
    }

    playSeq.current++;

    setLoadingKey(`${slot}:${versionKey}:upload`);
    setBusy("Uploading…");

    try {
      const uploadResult = await withTimeout(
        uploadSongFile({
          apiBase: API_BASE,
          projectId,
          slot,
          versionKey,
          file,
        }),
        10 * 60 * 1000,
        "Upload timed out. Try again or use a smaller file."
      );

      const newS3Key = uploadResult?.s3Key || "";
      if (!newS3Key) throw new Error("Upload did not return s3Key");

      // ✅ NEW: compute duration and persist it
      let durationSec = 0;
      try {
        durationSec = await getAudioDurationSecFromFile(file);
      } catch {
        durationSec = 0;
      }

      updateSong(slot, (s) => {
        const prevFiles = s?.files || {};
        const prevVer = prevFiles?.[versionKey] || {};
        return {
          // ✅ store at song-level too
          durationSec: durationSec || s?.durationSec || 0,
          files: {
            ...prevFiles,
            [versionKey]: {
              ...prevVer,
              fileName: file.name,
              s3Key: newS3Key,
              playbackUrl: "",
              // ✅ store at version level (masterSave reads this for albumTracks)
              durationSec: durationSec || 0,
            },
          },
        };
      });

      setBusy("Finalizing…");

      const freshUrl = await withTimeout(
        fetchPlaybackUrl({
          apiBase: API_BASE,
          s3Key: newS3Key,
        }),
        2 * 60 * 1000,
        "Playback URL timed out."
      );

      updateSong(slot, (s) => ({
        files: {
          ...(s.files || {}),
          [versionKey]: { ...(s.files?.[versionKey] || {}), playbackUrl: freshUrl },
        },
      }));

      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Upload failed");
    } finally {
      setLoadingKey("");
    }
  }

  /* ---------- MASTER SAVE ---------- */

  async function masterSave() {
    setErr("");

    if (!API_BASE) {
      setErr(
        "Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.\n" +
          "Example: VITE_API_BASE=https://album-backend-kmuo.onrender.com"
      );
      return;
    }

    const ok1 = window.confirm("Are you sure you're ready to save?");
    if (!ok1) return;

    const ok2 = window.confirm("Ok last chance, check your work!  Final step!");
    if (!ok2) return;

    setBusy("Master Saving…");

    try {
      const stamp = new Date().toISOString();

      const normalizedSongs = (Array.isArray(project?.catalog?.songs) ? project.catalog.songs : []).map((s) => {
        const slot = Number(s?.slot || 0) || 0;
        const title = String(s?.title || "").trim();
        return {
          ...s,
          slot,
          title,
          titleJson: ensureSongTitleJson(slot, title),
        };
      });

      // ✅ songTitles for legacy/simple consumers
      const albumSongTitles = normalizedSongs
        .filter((s) => Number(s.slot) > 0)
        .map((s) => ({ slot: Number(s.slot), title: String(s.title || "") }));

      // ✅ IMPORTANT: album.tracks is what publish should use.
      // Only include tracks that actually have an uploaded Album-version file.
      const albumTracks = normalizedSongs
        .map((s) => {
          const slot = Number(s.slot);
          const title = String(s.title || "").trim();
          const fAlbum = s?.files?.album || s?.files?.Album || s?.files?.ALBUM; // defensive
          const s3Key = String(fAlbum?.s3Key || "").trim();
          const durationSec = Number(fAlbum?.durationSec || s?.durationSec || 0) || 0; // ✅ NEW: fallback

          if (!slot || !s3Key) return null;

          return {
            slot,
            title: title || `Track ${slot}`,
            s3Key,
            durationSec,
          };
        })
        .filter(Boolean);

      const projectForSnapshot = {
        ...(project || {}),
        catalog: { ...(project?.catalog || {}), songs: normalizedSongs },
        album: {
          ...(project?.album || {}),
          songTitles: albumSongTitles,
          // ✅ NEW: publish consumes this
          tracks: albumTracks,
        },
        masterSave: {
          ...(project?.masterSave || {}),
          lastMasterSaveAt: stamp,
          sections: {
            ...(project?.masterSave?.sections || {}),
            catalog: { complete: true, masterSavedAt: stamp },
          },
        },
      };

      const snapshot = buildSnapshot({ projectId, project: projectForSnapshot });
      const projectForBackend = projectForBackendFromSnapshot(snapshot);

      const out = await postMasterSave({
        apiBase: API_BASE,
        projectId,
        projectForBackend,
      });

      setMasterSaveLastAt(stamp);
      setMasterSaveSnapshotKey(out?.snapshotKey || "");

      updateProject((prev) => {
        const next = { ...prev };
        next.catalog = projectForSnapshot.catalog;
        next.album = projectForSnapshot.album;
        next.masterSave = projectForSnapshot.masterSave;
        return next;
      });

      window.alert("Master Save complete.");
    } catch (e) {
      setErr(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  /* ---------- render ---------- */

  if (!projectId) {
    return <div style={{ padding: 24, fontWeight: 900 }}>Missing projectId</div>;
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <style>{`
        @keyframes eqPulse1 { 0%{transform:scaleY(.25)} 50%{transform:scaleY(1)} 100%{transform:scaleY(.35)} }
        @keyframes eqPulse2 { 0%{transform:scaleY(.65)} 50%{transform:scaleY(.25)} 100%{transform:scaleY(1)} }
        @keyframes eqPulse3 { 0%{transform:scaleY(.35)} 50%{transform:scaleY(.95)} 100%{transform:scaleY(.25)} }
        .eq1 { animation: eqPulse1 700ms infinite ease-in-out; }
        .eq2 { animation: eqPulse2 620ms infinite ease-in-out; }
        .eq3 { animation: eqPulse3 760ms infinite ease-in-out; }
      `}</style>

      <div
        style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          background: "#fff",
          paddingTop: 6,
          paddingBottom: 10,
          borderBottom: "1px solid rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>Catalog</div>
            <div style={{ fontSize: 16, opacity: 0.8, marginTop: 6 }}>
              Project: <b style={{ fontFamily: "monospace" }}>{projectId}</b>
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Backend: <span style={{ fontFamily: "monospace" }}>{API_BASE || "—"}</span>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 22 }}>Player</div>

          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
            {activeTrack ? `Now Playing: ${activeTrack.slot}:${activeTrack.versionKey}` : "Now Playing: —"}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                const a = audioRef.current;
                if (!a || !activeTrack) return;
                if (a.paused) a.play().catch(() => {});
                else a.pause();
              }}
              disabled={!activeTrack}
              style={{ padding: "10px 12px", fontWeight: 900 }}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>

            <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <input
              type="range"
              min={0}
              max={Math.max(0, Math.floor(duration || 0))}
              value={Math.floor(currentTime || 0)}
              onMouseDown={() => setIsSeeking(true)}
              onTouchStart={() => setIsSeeking(true)}
              onChange={(e) => setCurrentTime(Number(e.target.value || 0))}
              onMouseUp={() => {
                const a = audioRef.current;
                if (a) a.currentTime = clamp(currentTime, 0, duration || 0);
                setIsSeeking(false);
              }}
              onTouchEnd={() => {
                const a = audioRef.current;
                if (a) a.currentTime = clamp(currentTime, 0, duration || 0);
                setIsSeeking(false);
              }}
              style={{ width: "100%" }}
              disabled={!activeTrack}
            />
          </div>

          <audio ref={audioRef} />
        </div>

        {busy ? <div style={{ marginTop: 10, fontWeight: 800 }}>{busy}</div> : null}
        {err ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(244,63,94,0.25)",
              background: "rgba(244,63,94,0.08)",
              color: "#9f1239",
              fontWeight: 900,
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px 1fr 1fr 1fr",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div style={{ padding: 12, fontWeight: 950 }}>Song</div>
          <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>Album</div>
          <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>A</div>
          <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>B</div>
        </div>

        {songs.map((s, idx) => (
          <div
            key={s.slot}
            style={{
              display: "grid",
              gridTemplateColumns: "220px 1fr 1fr 1fr",
              borderBottom: idx === songs.length - 1 ? "none" : "1px solid #eef2f7",
            }}
          >
            <div style={{ padding: 12 }}>
              <div style={{ fontWeight: 950 }}>Song {s.slot}</div>
              <input
                value={s.title || ""}
                onChange={(e) => {
                  const title = e.target.value;
                  updateSong(s.slot, {
                    title,
                    titleJson: ensureSongTitleJson(s.slot, title),
                  });
                }}
                placeholder="Enter title"
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>

            {VERSION_KEYS.map((v) => {
              const f = s.files?.[v.key] || { fileName: "", s3Key: "", playbackUrl: "" };
              const playing = sameTrack({ slot: s.slot, versionKey: v.key }, activeTrack) && isPlaying;

              const rowLoad = loadingKey === `${s.slot}:${v.key}`;
              const upLoad = loadingKey === `${s.slot}:${v.key}:upload`;

              return (
                <div key={v.key} style={{ padding: 12, borderLeft: "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <PlayingEq active={playing} />
                      <div style={{ fontWeight: 950 }}>{v.key.toUpperCase()}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => document.getElementById(`u-${s.slot}-${v.key}`)?.click()}
                      disabled={upLoad}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #111827",
                        background: upLoad ? "#e5e7eb" : "#111827",
                        color: upLoad ? "#6b7280" : "#fff",
                        fontWeight: 900,
                        cursor: upLoad ? "not-allowed" : "pointer",
                      }}
                    >
                      {upLoad ? "Uploading…" : "Upload"}
                    </button>

                    <input
                      id={`u-${s.slot}-${v.key}`}
                      type="file"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.target.value = "";
                        onUpload(s.slot, v.key, file);
                      }}
                    />
                  </div>

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                    File:{" "}
                    <span style={{ fontFamily: "monospace", fontWeight: 800 }}>
                      {f.fileName || "—"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTrack({ slot: s.slot, versionKey: v.key });
                      togglePlay(s.slot, v.key);
                    }}
                    style={{
                      marginTop: 10,
                      width: "100%",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      fontWeight: 900,
                      cursor: f.s3Key && !rowLoad ? "pointer" : "not-allowed",
                      opacity: rowLoad ? 0.75 : 1,
                    }}
                    disabled={!f.s3Key || rowLoad}
                  >
                    {rowLoad ? "Loading…" : playing ? "Pause" : "Play"}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {masterSaveSnapshotKey ? (
          <div
            style={{
              marginBottom: 10,
              padding: 10,
              borderRadius: 12,
              border: "1px solid rgba(16,185,129,0.35)",
              background: "rgba(16,185,129,0.10)",
              color: "#065f46",
              fontWeight: 900,
            }}
          >
            ✅ SnapshotKey:{" "}
            <span style={{ fontFamily: "monospace" }}>{masterSaveSnapshotKey}</span>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={masterSave}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: "#111827",
              color: "#fff",
              fontWeight: 950,
              cursor: "pointer",
            }}
          >
            Master Save
          </button>
        </div>

        {masterSaveLastAt ? (
          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
            Last Master Save:{" "}
            <span style={{ fontFamily: "monospace", fontWeight: 800 }}>{masterSaveLastAt}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
