// FILE: src/minisite/Album.jsx
// FINALIZED ALBUM PAGE — LAYOUT LOCKED
// Features:
// - 2-column locked layout (no further replacements)
// - Playlist card (drag & drop gated by Playlist lock)
// - Songs play in drag order when clicked
// - Player with play/pause/prev/next/scrub/time
// - Album Meta card (title, artist, release date, total time) with its own lock
// - Album Cover Upload card with its own lock
// - Independent locks: Playlist / Album Meta / Album Cover

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-LAYOUT-LOCKED-2026-01-11-B";

/* ---------- helpers ---------- */
function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}
function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/* ---------- lock pill ---------- */
function LockPill({ label, locked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontWeight: 900,
        background: locked ? "#fee2e2" : "#dcfce7",
        color: locked ? "#991b1b" : "#166534",
        cursor: "pointer",
      }}
    >
      {label}: {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}

/* ---------- main ---------- */
export default function Album() {
  const { projectId: pid } = useParams();
  const location = useLocation();
  const projectId = pid || new URLSearchParams(location.search).get("projectId") || "";
  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));

  /* locks */
  const [playlistLocked, setPlaylistLocked] = useState(false);
  const [metaLocked, setMetaLocked] = useState(false);
  const [coverLocked, setCoverLocked] = useState(false);

  /* album meta */
  const [albumMeta, setAlbumMeta] = useState({
    title: "",
    artist: "",
    releaseDate: "",
  });

  /* playlist */
  const [playlist, setPlaylist] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);

  /* cover */
  const [coverPreview, setCoverPreview] = useState("");
  const coverUrlRef = useRef("");

  /* player */
  const audioRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  /* ---------- init ---------- */
  useEffect(() => {
    if (!projectId) return;
    const stored = loadProject(projectId);
    if (!stored) return;

    const album = stored.album || {};
    const locks = album.locks || {};

    setPlaylistLocked(parseLock(locks.playlistComplete));
    setMetaLocked(parseLock(locks.metaComplete));
    setCoverLocked(parseLock(locks.coverComplete));

    setAlbumMeta({
      title: album.meta?.title || "",
      artist: album.meta?.artist || "",
      releaseDate: album.meta?.releaseDate || "",
    });

    setPlaylist(Array.isArray(album.songs) ? album.songs : []);
    setCoverPreview(album.cover?.localPreviewUrl || "");
    setProject(stored);
  }, [projectId]);

  /* ---------- audio ---------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime || 0);
    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnd = () => playNext();

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  }, [activeIndex]);

  /* ---------- playback ---------- */
  async function playIndex(idx) {
    const item = playlist[idx];
    if (!item?.file?.s3Key) return;

    const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: item.file.s3Key });
    const a = audioRef.current;
    if (!a) return;

    a.src = url;
    a.currentTime = 0;
    a.load();
    await once(a, "canplay");
    await a.play();

    setActiveIndex(idx);
    setPlaying(true);
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play();
      setPlaying(true);
    }
  }

  function playPrev() {
    if (activeIndex > 0) playIndex(activeIndex - 1);
  }
  function playNext() {
    if (activeIndex < playlist.length - 1) playIndex(activeIndex + 1);
  }

  /* ---------- drag ---------- */
  function onDragStart(i) {
    if (playlistLocked) return;
    setDragIndex(i);
  }
  function onDrop(i) {
    if (playlistLocked || dragIndex === null) return;
    const next = [...playlist];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    setPlaylist(next);
    setDragIndex(null);

    const nextProject = {
      ...project,
      album: { ...(project.album || {}), songs: next },
    };
    saveProject(projectId, nextProject);
    setProject(nextProject);
  }

  /* ---------- cover upload ---------- */
  function setCoverFile(file) {
    if (coverLocked || !file) return;

    if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    const url = URL.createObjectURL(file);
    coverUrlRef.current = url;
    setCoverPreview(url);

    const nextProject = {
      ...project,
      album: {
        ...(project.album || {}),
        cover: { localPreviewUrl: url },
      },
    };
    saveProject(projectId, nextProject);
    setProject(nextProject);
  }

  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const totalAlbumTime = playlist.reduce((a, b) => a + Number(b?.duration || 0), 0);

  /* ---------- render ---------- */
  return (
    <div style={{ maxWidth: 1200, padding: 20 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        Album · Project {projectId} · Build <code>{ALBUM_BUILD_STAMP}</code>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* LEFT COLUMN — PLAYLIST */}
        <div>
          <LockPill label="Playlist" locked={playlistLocked} onToggle={() => setPlaylistLocked(v => !v)} />
          <div style={{ marginTop: 10 }}>
            {playlist.map((t, i) => (
              <div
                key={i}
                draggable={!playlistLocked}
                onDragStart={() => onDragStart(i)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => playIndex(i)}
                style={{
                  padding: 10,
                  marginBottom: 6,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: i === activeIndex ? "#eef2ff" : "#fff",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <div>{i + 1}. {t.title}</div>
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtTime(t.duration || 0)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* PLAYER CARD */}
          <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 900 }}>Player</div>
            <audio ref={audioRef} />
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={playPrev}>Prev</button>
              <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
              <button onClick={playNext}>Next</button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 12, marginTop: 6 }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>
            <input
              type="range"
              min={0}
              max={Math.floor(dur || 0)}
              value={Math.floor(time || 0)}
              onChange={e => audioRef.current && (audioRef.current.currentTime = Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          {/* ALBUM META CARD */}
          <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 14, padding: 14 }}>
            <LockPill label="Album Meta" locked={metaLocked} onToggle={() => setMetaLocked(v => !v)} />
            <input disabled={metaLocked} placeholder="Album Title" value={albumMeta.title} style={{ width: "100%", marginTop: 8 }} />
            <input disabled={metaLocked} placeholder="Artist Name" value={albumMeta.artist} style={{ width: "100%", marginTop: 8 }} />
            <input disabled={metaLocked} placeholder="Release Date" value={albumMeta.releaseDate} style={{ width: "100%", marginTop: 8 }} />
            <div style={{ marginTop: 8, fontSize: 12 }}>Total Time: <strong>{fmtTime(totalAlbumTime)}</strong></div>
          </div>

          {/* COVER CARD */}
          <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 14, padding: 14 }}>
            <LockPill label="Album Cover" locked={coverLocked} onToggle={() => setCoverLocked(v => !v)} />
            {!coverLocked && (
              <input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0])} />
            )}
            {coverPreview && (
              <img src={coverPreview} alt="cover" style={{ marginTop: 10, maxWidth: "100%", borderRadius: 10 }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
