// FILE: src/minisite/Catalog.jsx
// Static-site safe Catalog:
// - NO upload UI
// - NO upload-to-s3 calls
// - Does NOT require VITE_API_BASE until user clicks Play
// - Slot count is dynamic (1, 4, any number)
// - Admin/internal can add/remove songs locally for testing

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, useSearchParams } from "react-router-dom";

import {
  VERSION_KEYS,
  loadProject,
  saveProject,
  emptySong,
  ensureSongTitleJson,
  clamp,
  fmtTime,
  once,
  fetchPlaybackUrl,
} from "./catalog/catalogCore.js";

/** detect expired/invalid presigned URL */
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

function normalizeSongs(existingSongs) {
  const existing = Array.isArray(existingSongs) ? existingSongs : [];
  // Keep as-is, but ensure each item has stable shape.
  return existing
    .map((s) => {
      const slot = Number(s?.slot || 0) || 0;
      const base = emptySong(slot || 1);
      const merged = { ...base, ...s, slot: slot || base.slot };

      // titleJson
      if (!merged.titleJson || typeof merged.titleJson !== "object") {
        merged.titleJson = ensureSongTitleJson(merged.slot, merged.title || "");
      } else {
        merged.titleJson = {
          slot: Number(merged.titleJson.slot ?? merged.slot),
          title: String(merged.titleJson.title ?? merged.title ?? ""),
          updatedAt: String(merged.titleJson.updatedAt || ""),
          source: String(merged.titleJson.source || "catalog"),
        };
      }

      // files
      const files = merged.files && typeof merged.files === "object" ? merged.files : {};
      merged.files = {
        album: {
          fileName: String(files?.album?.fileName || ""),
          s3Key: String(files?.album?.s3Key || ""),
          playbackUrl: String(files?.album?.playbackUrl || ""),
        },
        a: {
          fileName: String(files?.a?.fileName || ""),
          s3Key: String(files?.a?.s3Key || ""),
          playbackUrl: String(files?.a?.playbackUrl || ""),
        },
        b: {
          fileName: String(files?.b?.fileName || ""),
          s3Key: String(files?.b?.s3Key || ""),
          playbackUrl: String(files?.b?.playbackUrl || ""),
        },
      };

      return merged;
    })
    .filter((s) => Number(s.slot) > 0)
    .sort((x, y) => Number(x.slot) - Number(y.slot));
}

function nextSlotNumber(songs) {
  const used = new Set((songs || []).map((s) => Number(s.slot)));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export default function Catalog() {
  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const token = (searchParams.get("token") || "").trim();
  const isAdmin = (searchParams.get("admin") || "").trim() === "1";
  const isProducerView = !!token && !isAdmin;

  const projectId = useMemo(() => {
    const fromParams = (params?.projectId || "").trim();
    if (fromParams) return fromParams;
    const sp = new URLSearchParams(location.search || "");
    return (sp.get("projectId") || "").trim();
  }, [params, location.search]);

  // IMPORTANT: do not hard-crash on missing env at render time
  const API_BASE = useMemo(() => {
    return String(import.meta.env.VITE_API_BASE || "")
      .trim()
      .replace(/\/+$/, "");
  }, []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [missingProject, setMissingProject] = useState(false);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [loadingKey, setLoadingKey] = useState("");

  const [activeTrack, setActiveTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  const audioRef = useRef(null);
  const playSeq = useRef(0);

  // Load project on projectId change
  useEffect(() => {
    if (!projectId) return;

    const loaded = loadProject(projectId);
    setProject(loaded);

    // Producer links are read-only and should not auto-create data.
    if (isProducerView && !loaded) setMissingProject(true);
    else setMissingProject(false);

    // Internal/admin can create a minimal local project if missing (for testing).
    if (!isProducerView && !loaded) {
      const base = {
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        catalog: { songs: [] },
        album: {},
        nftMix: {},
        songs: {},
        meta: {},
      };
      saveProject(projectId, base);
      setProject(base);
    }
  }, [projectId, isProducerView]);

  function updateProject(fn) {
    if (isProducerView) return;
    setProject((prev) => {
      const next = fn(prev || {});
      next.updatedAt = new Date().toISOString();
      saveProject(projectId, next);
      return next;
    });
  }

  function updateSong(slot, patchOrFn) {
    updateProject((prev) => {
      const prevSongs = normalizeSongs(prev?.catalog?.songs);
      const nextSongs = prevSongs.map((s) => {
        if (Number(s.slot) !== Number(slot)) return s;
        const patch = typeof patchOrFn === "function" ? patchOrFn(s) : patchOrFn;
        const merged = { ...s, ...patch };
        // keep titleJson in sync if title changes
        if (patch && Object.prototype.hasOwnProperty.call(patch, "title")) {
          merged.titleJson = ensureSongTitleJson(slot, merged.title || "");
        }
        return merged;
      });
      return { ...prev, catalog: { ...(prev.catalog || {}), songs: nextSongs } };
    });
  }

  const songs = useMemo(() => normalizeSongs(project?.catalog?.songs), [project]);

  function sameTrack(a, b) {
    return (
      a &&
      b &&
      Number(a.slot) === Number(b.slot) &&
      String(a.versionKey) === String(b.versionKey)
    );
  }

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
        "Missing VITE_API_BASE on this build. Playback needs the backend.\n" +
          "Set on Render Static Site and redeploy.\n" +
          "Example: VITE_API_BASE=https://album-backend-xxxxx.onrender.com"
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
      const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });

      // For internal/admin, keep playbackUrl only in memory/UI (not required, but ok).
      if (!isProducerView) {
        updateSong(slot, (s) => ({
          files: {
            ...(s.files || {}),
            [versionKey]: { ...(s.files?.[versionKey] || {}), playbackUrl: url },
          },
        }));
      }

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
        if (isExpiredPresignError(e)) {
          const fresh = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
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

  const canEdit = !isProducerView && !missingProject;

  function addSong() {
    if (!canEdit) return;
    updateProject((prev) => {
      const prevSongs = normalizeSongs(prev?.catalog?.songs);
      const slot = nextSlotNumber(prevSongs);
      const nextSongs = [...prevSongs, emptySong(slot)];
      return { ...prev, catalog: { ...(prev.catalog || {}), songs: nextSongs } };
    });
  }

  function removeSong(slot) {
    if (!canEdit) return;
    updateProject((prev) => {
      const prevSongs = normalizeSongs(prev?.catalog?.songs);
      const nextSongs = prevSongs.filter((s) => Number(s.slot) !== Number(slot));
      return { ...prev, catalog: { ...(prev.catalog || {}), songs: nextSongs } };
    });
  }

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
              {isProducerView ? (
                <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7, fontWeight: 900 }}>
                  Producer View (read-only)
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Backend: <span style={{ fontFamily: "monospace" }}>{API_BASE || "—"}</span>
          </div>
        </div>

        {missingProject ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(245,158,11,0.35)",
              background: "rgba(245,158,11,0.10)",
              color: "#92400e",
              fontWeight: 900,
              lineHeight: 1.4,
            }}
          >
            This link is valid, but no project data exists in this browser.
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 800 }}>
              Producer links do not auto-load localStorage. Use Admin Preview / internal browser with the project loaded.
            </div>
          </div>
        ) : null}

        <div
          style={{
            marginTop: 10,
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
            opacity: missingProject ? 0.75 : 1,
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

        {!isProducerView ? (
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={addSong}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Add Song
            </button>

            <div style={{ fontSize: 12, opacity: 0.6 }}>
              Uploads are disabled on static site. To test playback, paste s3Key values into files.*.s3Key.
            </div>
          </div>
        ) : null}
      </div>

      {/* Empty state */}
      {!songs.length ? (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontWeight: 900,
            opacity: missingProject ? 0.7 : 1,
          }}
        >
          No songs in this project.
          {!isProducerView ? (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
              Click <b>Add Song</b> above to create rows for testing.
            </div>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "hidden",
            background: "#fff",
            opacity: missingProject ? 0.85 : 1,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 1fr 1fr", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ padding: 12, fontWeight: 950 }}>Song</div>
            <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>Album</div>
            <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>A</div>
            <div style={{ padding: 12, fontWeight: 950, borderLeft: "1px solid #e5e7eb" }}>B</div>
          </div>

          {songs.map((s, idx, arr) => (
            <div
              key={s.slot}
              style={{
                display: "grid",
                gridTemplateColumns: "260px 1fr 1fr 1fr",
                borderBottom: idx === arr.length - 1 ? "none" : "1px solid #eef2f7",
              }}
            >
              <div style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 950 }}>Song {s.slot}</div>
                  {!isProducerView ? (
                    <button
                      type="button"
                      onClick={() => removeSong(s.slot)}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                        opacity: 0.9,
                      }}
                      title="Remove song row"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <input
                  value={s.title || ""}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const title = e.target.value;
                    updateSong(s.slot, { title, titleJson: ensureSongTitleJson(s.slot, title) });
                  }}
                  placeholder={missingProject ? "—" : "Enter title"}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "10px 10px",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    background: canEdit ? "#fff" : "#f8fafc",
                  }}
                />

                {!isProducerView ? (
                  <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65, lineHeight: 1.35 }}>
                    To test playback, set s3Key on any version:
                    <div style={{ fontFamily: "monospace", marginTop: 4 }}>
                      files.album.s3Key / files.a.s3Key / files.b.s3Key
                    </div>
                  </div>
                ) : null}
              </div>

              {VERSION_KEYS.map((v) => {
                const f = s.files?.[v.key] || { fileName: "", s3Key: "", playbackUrl: "" };
                const playing = sameTrack({ slot: s.slot, versionKey: v.key }, activeTrack) && isPlaying;
                const rowLoad = loadingKey === `${s.slot}:${v.key}`;
                const hasKey = !!String(f.s3Key || "").trim();

                return (
                  <div key={v.key} style={{ padding: 12, borderLeft: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <PlayingEq active={playing} />
                        <div style={{ fontWeight: 950 }}>{v.key.toUpperCase()}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                      File:{" "}
                      <span style={{ fontFamily: "monospace", fontWeight: 800 }}>{f.fileName || "—"}</span>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                      s3Key:{" "}
                      <span style={{ fontFamily: "monospace", fontWeight: 800 }}>
                        {hasKey ? String(f.s3Key) : "—"}
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
                        cursor: hasKey && !rowLoad ? "pointer" : "not-allowed",
                        opacity: rowLoad ? 0.75 : 1,
                      }}
                      disabled={!hasKey || rowLoad}
                      title={!hasKey ? "No s3Key for this slot/version" : ""}
                    >
                      {rowLoad ? "Loading…" : playing ? "Pause" : "Play"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
