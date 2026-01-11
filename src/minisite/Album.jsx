// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  loadProject,
  saveProject,
  fmtTime,
  once,
  fetchPlaybackUrl,
} from "./catalog/catalogCore.js";

/* BUILD STAMP — MUST APPEAR IN UI */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-2COL-LOCKS-DRAG-PLAYER-2026-01-11-A";

/* ---------------- helpers ---------------- */

function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

function pickCatalogTitle(s, slot) {
  const tj = s?.titleJson;
  const fromJson = typeof tj === "object" ? String(tj?.title || "").trim() : "";
  const fromTitle = String(s?.title || "").trim();
  return fromJson || fromTitle || `Song ${slot}`;
}

function buildAlbumPlaylistFromCatalog(project) {
  const catalogSongs = Array.isArray(project?.catalog?.songs)
    ? project.catalog.songs
    : [];

  const bySlot = new Map(
    catalogSongs.map((s) => [
      Number(s?.slot || 0),
      {
        title: pickCatalogTitle(s, Number(s?.slot || 0)),
        s3Key: String(s?.files?.album?.s3Key || "").trim(),
      },
    ])
  );

  const maxSlot = Math.max(8, catalogSongs.length || 0);
  const out = [];

  for (let slot = 1; slot <= maxSlot; slot++) {
    const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "" };
    out.push({
      id: `slot-${slot}`,
      sourceSlot: slot,
      title: c.title,
      file: { s3Key: c.s3Key },
    });
  }

  return out;
}

function parseBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/* ---------------- UI bits ---------------- */

function LockButton({ locked, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: locked ? "#fee2e2" : "#dcfce7",
        color: locked ? "#991b1b" : "#166534",
        fontWeight: 900,
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {label}: {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}

function Card({ title, lock, children }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 14,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
        {lock}
      </div>
      {children}
    </div>
  );
}

/* ---------------- component ---------------- */

export default function Album() {
  const params = useParams();
  const location = useLocation();

  const projectId = useMemo(() => {
    const fromParams = (params?.projectId || "").trim();
    if (fromParams) return fromParams;
    const sp = new URLSearchParams(location.search || "");
    return (sp.get("projectId") || "").trim();
  }, [params, location.search]);

  const API_BASE = useMemo(
    () => normalizeBase(import.meta.env.VITE_BACKEND_URL),
    []
  );

  const [project, setProject] = useState(null);

  /* -------- independent locks -------- */
  const [locks, setLocks] = useState({
    playlist: false,
    meta: false,
    cover: false,
  });

  /* -------- playlist -------- */
  const [playlist, setPlaylist] = useState([]);
  const dragIndexRef = useRef(null);

  /* -------- player -------- */
  const audioRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  /* -------- meta -------- */
  const [albumName, setAlbumName] = useState("");
  const [performer, setPerformer] = useState("");
  const [releaseDate, setReleaseDate] = useState("");

  /* -------- cover -------- */
  const [coverPreview, setCoverPreview] = useState("");

  /* -------- init -------- */
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
          locks: { playlist: false, meta: false, cover: false },
          meta: {},
          cover: {},
        },
      };

    const next = {
      ...base,
      album: {
        ...(base.album || {}),
        locks: {
          playlist: parseBool(base.album?.locks?.playlist),
          meta: parseBool(base.album?.locks?.meta),
          cover: parseBool(base.album?.locks?.cover),
        },
      },
    };

    if (!stored) saveProject(projectId, next);

    setProject(next);
    setLocks(next.album.locks);

    const initialPlaylist =
      Array.isArray(next.album.playlist) && next.album.playlist.length
        ? next.album.playlist
        : buildAlbumPlaylistFromCatalog(next);

    setPlaylist(initialPlaylist);

    setAlbumName(next.album.meta?.albumName || "");
    setPerformer(next.album.meta?.performer || "");
    setReleaseDate(next.album.meta?.releaseDate || "");
    setCoverPreview(next.album.cover?.preview || "");
  }, [projectId]);

  /* -------- persist helpers -------- */
  function persist(next) {
    saveProject(projectId, next);
    setProject(next);
  }

  function toggleLock(key) {
    const nextLocks = { ...locks, [key]: !locks[key] };
    setLocks(nextLocks);

    persist({
      ...project,
      album: {
        ...project.album,
        locks: nextLocks,
        playlist:
          key === "playlist" && !locks.playlist ? playlist : project.album.playlist,
      },
    });
  }

  /* -------- drag & drop (playlist only) -------- */
  function onDragStart(i) {
    if (locks.playlist) return;
    dragIndexRef.current = i;
  }

  function onDrop(i) {
    if (locks.playlist) return;
    const from = dragIndexRef.current;
    if (from == null || from === i) return;

    const next = [...playlist];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    dragIndexRef.current = null;
    setPlaylist(next);
  }

  /* -------- player -------- */
  async function playAt(i) {
    const item = playlist[i];
    if (!item?.file?.s3Key) return;

    const url = await fetchPlaybackUrl({
      apiBase: API_BASE,
      s3Key: item.file.s3Key,
    });

    const a = audioRef.current;
    a.src = url;
    a.load();
    await once(a, "canplay");
    a.play();
    setActiveIdx(i);
  }

  function playNext() {
    if (activeIdx < playlist.length - 1) playAt(activeIdx + 1);
  }

  function playPrev() {
    if (activeIdx > 0) playAt(activeIdx - 1);
  }

  /* -------- audio events -------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setTime(a.currentTime || 0);
    const onDur = () => setDur(a.duration || 0);
    const onEnd = () => playNext();

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);

    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  });

  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  /* ---------------- render ---------------- */

  return (
    <div style={{ maxWidth: 1200, padding: 20 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        Project <b>{projectId}</b> · Build <code>{ALBUM_BUILD_STAMP}</code>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16,
        }}
      >
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card
            title="Playlist"
            lock={
              <LockButton
                label="Playlist"
                locked={locks.playlist}
                onToggle={() => toggleLock("playlist")}
              />
            }
          >
            {playlist.map((t, i) => (
              <div
                key={t.id}
                draggable={!locks.playlist}
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => playAt(i)}
                style={{
                  padding: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  marginBottom: 6,
                  cursor: locks.playlist ? "default" : "grab",
                  background: i === activeIdx ? "#e0f2fe" : "#fff",
                }}
              >
                {i + 1}. {t.title}
              </div>
            ))}
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Player">
            <audio ref={audioRef} />
            <div style={{ marginBottom: 6 }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>
            <input
              type="range"
              min={0}
              max={Math.floor(dur || 0)}
              value={Math.floor(time || 0)}
              onChange={(e) => (audioRef.current.currentTime = e.target.value)}
              style={{ width: "100%" }}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
              <button onClick={playPrev}>Prev</button>
              <button onClick={() => audioRef.current.play()}>Play</button>
              <button onClick={() => audioRef.current.pause()}>Pause</button>
              <button onClick={playNext}>Next</button>
            </div>
          </Card>

          <Card
            title="Album Meta"
            lock={
              <LockButton
                label="Meta"
                locked={locks.meta}
                onToggle={() => toggleLock("meta")}
              />
            }
          >
            <input
              disabled={locks.meta}
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              placeholder="Album Name"
              style={{ width: "100%", marginBottom: 6 }}
            />
            <input
              disabled={locks.meta}
              value={performer}
              onChange={(e) => setPerformer(e.target.value)}
              placeholder="Performer"
              style={{ width: "100%", marginBottom: 6 }}
            />
            <input
              disabled={locks.meta}
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              placeholder="Release Date"
              style={{ width: "100%" }}
            />
          </Card>

          <Card
            title="Album Cover"
            lock={
              <LockButton
                label="Cover"
                locked={locks.cover}
                onToggle={() => toggleLock("cover")}
              />
            }
          >
            {!locks.cover && (
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setCoverPreview(URL.createObjectURL(e.target.files[0]))
                }
              />
            )}
            {coverPreview && (
              <img
                src={coverPreview}
                alt="cover"
                style={{ marginTop: 10, maxWidth: "100%" }}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
