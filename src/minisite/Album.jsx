// src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * RULES:
 * - Catalog is source of truth for audio files
 * - Album only reads Catalog album files (files.album)
 * - No A/B logic here
 * - No slideshow
 * - No demo fallback
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL;

/* ---------------- helpers ---------------- */

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function projectKey(projectId) {
  return `project_${projectId}`;
}

function loadProject(projectId) {
  const raw = localStorage.getItem(projectKey(projectId));
  return raw ? safeParse(raw) : null;
}

function saveProject(projectId, data) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(data));
}

function fmt(sec) {
  const s = Math.floor(sec || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function Album() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId");

  const audioRef = useRef(null);

  const [project, setProject] = useState(null);
  const [albumSongs, setAlbumSongs] = useState([]);
  const [activeSlot, setActiveSlot] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [metaLocked, setMetaLocked] = useState(false);
  const [playlistLocked, setPlaylistLocked] = useState(false);

  /* ---------------- load project ---------------- */

  useEffect(() => {
    if (!projectId) return;
    const p = loadProject(projectId);
    if (!p) return;
    setProject(p);
  }, [projectId]);

  /* ---------------- sync catalog → album ---------------- */

  useEffect(() => {
    if (!project?.catalog?.songs) return;

    const catalog = project.catalog.songs;

    const nextAlbumSongs = catalog
      .filter(s => s?.files?.album?.s3Key)
      .slice(0, 9)
      .map(s => ({
        slot: Number(s.slot),
        title: s.title || `Song ${s.slot}`,
        s3Key: s.files.album.s3Key
      }));

    setAlbumSongs(nextAlbumSongs);

    const nextProject = {
      ...project,
      album: {
        ...(project.album || {}),
        songs: nextAlbumSongs
      }
    };

    saveProject(projectId, nextProject);
    setProject(nextProject);
  }, [project]);

  /* ---------------- audio ---------------- */

  const play = async (song) => {
    if (!song?.s3Key) return;

    if (activeSlot === song.slot && playing) {
      audioRef.current.pause();
      return;
    }

    const r = await fetch(
      `${API_BASE}/api/playback-url?s3Key=${encodeURIComponent(song.s3Key)}`
    );
    const j = await r.json();

    audioRef.current.src = j.url;
    audioRef.current.load();
    await audioRef.current.play();

    setActiveSlot(song.slot);
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(a.currentTime || 0);
    const onLoad = () => setDuration(a.duration || 0);

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoad);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoad);
    };
  }, []);

  const totalTime = useMemo(
    () => albumSongs.length ? albumSongs.length * duration : 0,
    [albumSongs, duration]
  );

  if (!projectId) {
    return <div style={{ padding: 40, fontWeight: 900 }}>Missing Project ID</div>;
  }

  /* ---------------- render ---------------- */

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>Album</h1>

      {/* META */}
      <div style={{ border: "1px solid #ddd", padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <b>Album Meta</b>
          <button
            onClick={() => setMetaLocked(v => !v)}
            style={{
              background: metaLocked ? "#7f1d1d" : "#065f46",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 6
            }}
          >
            {metaLocked ? "Locked" : "Unlocked"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Total Album Time: <b>{fmt(totalTime)}</b></div>
          <div>Project ID: <code>{projectId}</code></div>
          <div>Backend: <code>{API_BASE}</code></div>
        </div>
      </div>

      {/* PLAYER */}
      <div style={{ border: "1px solid #ddd", padding: 16, marginBottom: 20 }}>
        <b>Player</b>
        <div>{fmt(time)} / {fmt(duration)}</div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={time}
          onChange={e => {
            audioRef.current.currentTime = Number(e.target.value);
          }}
          style={{ width: "100%" }}
        />
        <audio ref={audioRef} />
      </div>

      {/* PLAYLIST */}
      <div style={{ border: "1px solid #ddd", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <b>Album Playlist (from Catalog)</b>
          <button
            onClick={() => setPlaylistLocked(v => !v)}
            style={{
              background: playlistLocked ? "#7f1d1d" : "#065f46",
              color: "#fff",
              padding: "4px 10px",
              borderRadius: 6
            }}
          >
            {playlistLocked ? "Locked" : "Unlocked"}
          </button>
        </div>

        {albumSongs.map(song => (
          <div
            key={song.slot}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 0",
              borderBottom: "1px solid #eee"
            }}
          >
            <div>
              #{song.slot} — {song.title}
            </div>
            <button onClick={() => play(song)}>
              {activeSlot === song.slot && playing ? "Pause" : "Play"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
