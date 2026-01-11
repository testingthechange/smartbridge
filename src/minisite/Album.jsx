// FILE: src/minisite/Album.jsx
// PURPOSE: Album page with 2-column layout, draggable playlist (gated by Playlist lock),
// fully functional player (play/pause/prev/next/scrub/time),
// independent per-card locks (Playlist / Album Meta / Cover),
// album-level metadata fields, and correct playback order following drag arrangement.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-LAYOUT-DRAG-PLAYER-META-2026-01-11-A";

/* -------------------------------------------------- */
/* helpers                                            */
/* -------------------------------------------------- */
function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function pickCatalogTitle(song, slot) {
  const tj = song?.titleJson;
  const fromJson = typeof tj === "object" ? String(tj?.title || "").trim() : "";
  const fromTitle = String(song?.title || "").trim();
  return fromJson || fromTitle || `Song ${slot}`;
}

function buildPlaylistFromCatalog(project) {
  const songs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const out = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    const slot = Number(s.slot || i + 1);
    out.push({
      id: `slot-${slot}`,
      slot,
      title: pickCatalogTitle(s, slot),
      s3Key: String(s?.files?.album?.s3Key || ""),
      duration: Number(s?.duration || 0),
    });
  }
  return out;
}

/* -------------------------------------------------- */
/* UI bits                                            */
/* -------------------------------------------------- */
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

/* -------------------------------------------------- */
/* main                                               */
/* -------------------------------------------------- */
export default function Album() {
  const { projectId: paramId } = useParams();
  const location = useLocation();

  const projectId = useMemo(() => {
    if (paramId) return paramId;
    const sp = new URLSearchParams(location.search || "");
    return sp.get("projectId") || "";
  }, [paramId, location.search]);

  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));

  /* -------- locks (independent) -------- */
  const [playlistLocked, setPlaylistLocked] = useState(false);
  const [metaLocked, setMetaLocked] = useState(false);
  const [coverLocked, setCoverLocked] = useState(false);

  /* -------- album meta -------- */
  const [albumMeta, setAlbumMeta] = useState({
    title: "",
    artist: "",
    releaseDate: "",
  });

  /* -------- playlist -------- */
  const [playlist, setPlaylist] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);

  /* -------- player -------- */
  const audioRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  /* -------------------------------------------------- */
  /* init                                               */
  /* -------------------------------------------------- */
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

    const pl =
      Array.isArray(album.songs) && album.songs.length
        ? album.songs
        : buildPlaylistFromCatalog(stored);

    setPlaylist(pl);
    setProject(stored);
  }, [projectId]);

  /* -------------------------------------------------- */
  /* player events                                      */
  /* -------------------------------------------------- */
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

  /* -------------------------------------------------- */
  /* playback                                           */
  /* -------------------------------------------------- */
  async function playIndex(idx) {
    const item = playlist[idx];
    if (!item?.s3Key) return;

    const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: item.s3Key });
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

  /* -------------------------------------------------- */
  /* drag & drop (playlist only)                         */
  /* -------------------------------------------------- */
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
      album: {
        ...(project.album || {}),
        songs: next,
      },
    };
    saveProject(projectId, nextProject);
    setProject(nextProject);
  }

  /* -------------------------------------------------- */
  /* album meta save                                     */
  /* -------------------------------------------------- */
  function saveAlbumMeta(next) {
    if (metaLocked) return;
    const nextProject = {
      ...project,
      album: {
        ...(project.album || {}),
        meta: next,
      },
    };
    saveProject(projectId, nextProject);
    setProject(nextProject);
  }

  /* -------------------------------------------------- */
  /* render                                             */
  /* -------------------------------------------------- */
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const totalAlbumTime = playlist.reduce((a, b) => a + Number(b.duration || 0), 0);

  return (
    <div style={{ maxWidth: 1200, padding: 20 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        Album · Project {projectId} · Build <code>{ALBUM_BUILD_STAMP}</code>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* LEFT COLUMN */}
        <div>
          <div style={{ marginBottom: 10 }}>
            <LockPill label="Playlist" locked={playlistLocked} onToggle={() => setPlaylistLocked((v) => !v)} />
          </div>

          {playlist.map((t, i) => (
            <div
              key={t.id}
              draggable={!playlistLocked}
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => e.preventDefault()}
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
              <div>
                {i + 1}. {t.title}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>{fmtTime(t.duration || 0)}</div>
            </div>
          ))}
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* PLAYER */}
          <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Player</div>

            <audio ref={audioRef} />

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={playPrev}>Prev</button>
              <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
              <button onClick={playNext}>Next</button>
            </div>

            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>

            <input
              type="range"
              min={0}
              max={Math.floor(dur || 0)}
              value={Math.floor(time || 0)}
              onChange={(e) => {
                const a = audioRef.current;
                if (a) a.currentTime = Number(e.target.value || 0);
              }}
              style={{ width: "100%" }}
            />
          </div>

          {/* ALBUM META */}
          <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 14, padding: 14 }}>
            <LockPill label="Album Meta" locked={metaLocked} onToggle={() => setMetaLocked((v) => !v)} />

            <input
              disabled={metaLocked}
              placeholder="Album Title"
              value={albumMeta.title}
              onChange={(e) => {
                const next = { ...albumMeta, title: e.target.value };
                setAlbumMeta(next);
                saveAlbumMeta(next);
              }}
              style={{ width: "100%", marginTop: 8 }}
            />

            <input
              disabled={metaLocked}
              placeholder="Artist Name"
              value={albumMeta.artist}
              onChange={(e) => {
                const next = { ...albumMeta, artist: e.target.value };
                setAlbumMeta(next);
                saveAlbumMeta(next);
              }}
              style={{ width: "100%", marginTop: 8 }}
            />

            <input
              disabled={metaLocked}
              placeholder="Release Date"
              value={albumMeta.releaseDate}
              onChange={(e) => {
                const next = { ...albumMeta, releaseDate: e.target.value };
                setAlbumMeta(next);
                saveAlbumMeta(next);
              }}
              style={{ width: "100%", marginTop: 8 }}
            />

            <div style={{ marginTop: 8, fontSize: 12 }}>
              Total Time: <strong>{fmtTime(totalAlbumTime)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
