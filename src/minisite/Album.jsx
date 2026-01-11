// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { loadProject, saveProject, fetchPlaybackUrl, fmtTime, once } from "./catalog/catalogCore";

/* BUILD STAMP */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-PLAYLIST-DRAGLOCK-2026-01-11-A";

/* -------------------------------- helpers -------------------------------- */

function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

function buildPlaylistFromCatalog(project) {
  const songs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  return songs.map((s, i) => ({
    id: `slot-${i + 1}`,
    slot: i + 1,
    title: s?.title || `Song ${i + 1}`,
    s3Key: s?.files?.album?.s3Key || "",
  }));
}

/* ------------------------------- component -------------------------------- */

export default function Album() {
  const { projectId } = useParams();
  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [playlistLocked, setPlaylistLocked] = useState(false);

  /* player */
  const audioRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  /* album meta */
  const [albumName, setAlbumName] = useState("");
  const [performer, setPerformer] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [coverPreview, setCoverPreview] = useState("");

  /* ------------------------------ init -------------------------------- */

  useEffect(() => {
    if (!projectId) return;

    const stored = loadProject(projectId);
    const base =
      stored ||
      {
        projectId,
        catalog: { songs: [] },
        album: {
          playlist: [],
          playlistLocked: false,
          meta: {},
          cover: {},
        },
      };

    const pl =
      Array.isArray(base.album?.playlist) && base.album.playlist.length
        ? base.album.playlist
        : buildPlaylistFromCatalog(base);

    setProject(base);
    setPlaylist(pl);
    setPlaylistLocked(Boolean(base.album?.playlistLocked));
    setAlbumName(base.album?.meta?.albumName || "");
    setPerformer(base.album?.meta?.performer || "");
    setReleaseDate(base.album?.meta?.releaseDate || "");
    setCoverPreview(base.album?.cover?.localPreviewUrl || "");
  }, [projectId]);

  /* ------------------------------ persist -------------------------------- */

  function persist(next) {
    saveProject(projectId, next);
    setProject(next);
  }

  function persistAlbum(update) {
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        ...update,
      },
    };
    persist(next);
  }

  /* ------------------------------ player -------------------------------- */

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setTime(a.currentTime || 0);
    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnd = () => nextTrack();

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  }, [activeIndex, playlist]);

  async function playIndex(idx) {
    const item = playlist[idx];
    if (!item?.s3Key) return;

    const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: item.s3Key });
    const a = audioRef.current;

    a.pause();
    a.src = url;
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

  function prevTrack() {
    if (activeIndex > 0) playIndex(activeIndex - 1);
  }

  function nextTrack() {
    if (activeIndex < playlist.length - 1) playIndex(activeIndex + 1);
    else setPlaying(false);
  }

  /* --------------------------- drag & drop -------------------------------- */

  function onDragStart(e, idx) {
    if (playlistLocked) return;
    e.dataTransfer.setData("text/plain", String(idx));
  }

  function onDrop(e, idx) {
    if (playlistLocked) return;
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (from === idx) return;

    const next = [...playlist];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    setPlaylist(next);
    persistAlbum({ playlist: next });
  }

  /* ------------------------------- render -------------------------------- */

  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 10 }}>
        Album Build: <code>{ALBUM_BUILD_STAMP}</code>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* LEFT — PLAYER + PLAYLIST */}
        <div style={card()}>
          <h2>Playlist</h2>

          <button onClick={() => persistAlbum({ playlistLocked: !playlistLocked })} style={lockBtn()}>
            {playlistLocked ? "LOCKED" : "UNLOCKED"}
          </button>

          <div style={{ marginTop: 10 }}>
            {playlist.map((t, i) => (
              <div
                key={t.id}
                draggable={!playlistLocked}
                onDragStart={(e) => onDragStart(e, i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
                onClick={() => playIndex(i)}
                style={{
                  padding: 10,
                  marginBottom: 6,
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  background: i === activeIndex ? "#eef2ff" : "#fff",
                  cursor: playlistLocked ? "default" : "grab",
                }}
              >
                {i + 1}. {t.title}
              </div>
            ))}
          </div>

          {/* PLAYER */}
          <div style={{ marginTop: 16 }}>
            <audio ref={audioRef} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={prevTrack}>Prev</button>
              <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
              <button onClick={nextTrack}>Next</button>
            </div>

            <div style={{ marginTop: 8, fontFamily: "monospace" }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>

            <input
              type="range"
              min={0}
              max={Math.floor(dur || 0)}
              value={Math.floor(time || 0)}
              onChange={(e) => (audioRef.current.currentTime = Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* RIGHT — META + COVER */}
        <div style={card()}>
          <h2>Album Info</h2>

          <input value={albumName} onChange={(e) => setAlbumName(e.target.value)} placeholder="Album Name" />
          <input value={performer} onChange={(e) => setPerformer(e.target.value)} placeholder="Performer" />
          <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />

          <button
            onClick={() =>
              persistAlbum({
                meta: { albumName, performer, releaseDate },
              })
            }
          >
            Save Album Meta
          </button>

          <h3 style={{ marginTop: 14 }}>Cover</h3>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const url = URL.createObjectURL(file);
              setCoverPreview(url);
              persistAlbum({ cover: { localPreviewUrl: url } });
            }}
          />

          {coverPreview ? <img src={coverPreview} alt="cover" style={{ marginTop: 10, maxWidth: 220 }} /> : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- styles -------------------------------- */

function card() {
  return {
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: 16,
    background: "#fff",
  };
}

function lockBtn() {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    fontWeight: 900,
    border: "1px solid #ddd",
    background: "#f3f4f6",
    cursor: "pointer",
  };
}
