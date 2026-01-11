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

/* Album-local build stamp (not global) */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-2COL-UPLOAD-META-PLAYER-2026-01-11-B";

/* ---------------- helpers ---------------- */

function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

function pickCatalogTitle(s, slot) {
  const tj = s?.titleJson;
  return String(tj?.title || s?.title || `Song ${slot}`).trim();
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

  const maxSlot = Math.max(1, catalogSongs.length || 0);
  const out = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "" };
    out.push({
      index: out.length,
      sourceSlot: slot,
      title: c.title,
      s3Key: c.s3Key,
    });
  }
  return out;
}

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/* ---------------- UI bits ---------------- */

function Card({ title, locked, children }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 14,
        background: "#fff",
        opacity: locked ? 0.85 : 1,
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 950,
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        {locked ? <span style={{ color: "#991b1b" }}>LOCKED</span> : null}
      </div>
      {children}
    </div>
  );
}

function LockPill({ label, locked, onToggle }) {
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontWeight: 900,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}: {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}

/* ============================ COMPONENT ============================ */

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
    () => normalizeBase(import.meta.env.VITE_API_BASE),
    []
  );

  const [project, setProject] = useState(() =>
    projectId ? loadProject(projectId) : null
  );
  const [err, setErr] = useState("");

  /* locks */
  const [locks, setLocks] = useState({
    playlist: false,
    meta: false,
    cover: false,
  });

  /* player */
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  /* init */
  useEffect(() => {
    if (!projectId) return;
    const stored = loadProject(projectId);
    if (!stored) return;

    setProject(stored);

    const l = stored?.album?.locks || {};
    setLocks({
      playlist: parseLock(l.playlistComplete),
      meta: parseLock(l.metaComplete),
      cover: parseLock(l.coverComplete),
    });
  }, [projectId]);

  const playlist = useMemo(() => {
    if (!project) return [];
    if (locks.playlist && Array.isArray(project?.album?.songs)) {
      return project.album.songs.map((s, i) => ({
        index: i,
        title: s.title,
        s3Key: s.file?.s3Key || "",
      }));
    }
    return buildAlbumPlaylistFromCatalog(project);
  }, [project, locks.playlist]);

  /* audio events */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setTime(a.currentTime || 0);
    const onDur = () =>
      setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnded = () => {
      setPlaying(false);
      if (activeIndex + 1 < playlist.length) {
        playIndex(activeIndex + 1);
      }
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnded);
    };
  }, [activeIndex, playlist]);

  async function playIndex(idx) {
    setErr("");
    const item = playlist[idx];
    if (!item?.s3Key) return;

    const seq = ++playSeq.current;

    try {
      const url = await fetchPlaybackUrl({
        apiBase: API_BASE,
        s3Key: item.s3Key,
      });
      if (seq !== playSeq.current) return;

      const a = audioRef.current;
      if (!a) return;

      a.pause();
      a.src = url;
      a.load();
      await once(a, "canplay");
      if (seq !== playSeq.current) return;

      await a.play();
      setActiveIndex(idx);
      setPlaying(true);
    } catch (e) {
      setErr(e?.message || "Playback failed");
    }
  }

  function togglePlayPause() {
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

  function updateAlbumMeta(key, value) {
    if (locks.meta) return;
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        meta: {
          ...(project.album?.meta || {}),
          [key]: value,
        },
      },
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function updateCoverFile(file) {
    if (locks.cover || !file) return;

    const url = URL.createObjectURL(file);
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        cover: {
          ...(project.album?.cover || {}),
          localPreviewUrl: url,
        },
      },
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function toggleLock(key) {
    const map = {
      playlist: "playlistComplete",
      meta: "metaComplete",
      cover: "coverComplete",
    };
    const nextLocks = { ...locks, [key]: !locks[key] };
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        locks: {
          ...(project.album?.locks || {}),
          [map[key]]: nextLocks[key],
        },
      },
    };
    saveProject(projectId, next);
    setLocks(nextLocks);
    setProject(next);
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const albumMeta = project?.album?.meta || {};
  const coverPreview = project?.album?.cover?.localPreviewUrl || "";

  return (
    <div style={{ maxWidth: 1200, padding: 18 }}>
      <div style={{ fontSize: 28, fontWeight: 950, marginBottom: 14 }}>
        Album
      </div>

      {err ? (
        <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        {/* LEFT */}
        <Card title="Tracks & Player">
          {playlist.map((t, i) => (
            <div
              key={i}
              onClick={() => playIndex(i)}
              style={{
                padding: 10,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                marginBottom: 6,
                cursor: "pointer",
                background: i === activeIndex ? "#eef2ff" : "#fff",
                fontWeight: 900,
              }}
            >
              {i + 1}. {t.title}
            </div>
          ))}

          <div style={{ marginTop: 14 }}>
            <audio ref={audioRef} />
            <button
              type="button"
              onClick={togglePlayPause}
              style={{
                padding: "8px 12px",
                fontWeight: 900,
                marginBottom: 8,
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>

            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(0, Math.floor(dur))}
              value={Math.floor(time)}
              onChange={(e) => {
                const a = audioRef.current;
                if (a) a.currentTime = Number(e.target.value);
              }}
              style={{ width: "100%" }}
            />
          </div>
        </Card>

        {/* RIGHT */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Album Meta" locked={locks.meta}>
            <input
              placeholder="Album Name"
              value={albumMeta.albumName || ""}
              disabled={locks.meta}
              onChange={(e) =>
                updateAlbumMeta("albumName", e.target.value)
              }
              style={{ width: "100%", marginBottom: 8 }}
            />
            <input
              placeholder="Performer(s)"
              value={albumMeta.performers || ""}
              disabled={locks.meta}
              onChange={(e) =>
                updateAlbumMeta("performers", e.target.value)
              }
              style={{ width: "100%", marginBottom: 8 }}
            />
            <input
              type="date"
              value={albumMeta.releaseDate || ""}
              disabled={locks.meta}
              onChange={(e) =>
                updateAlbumMeta("releaseDate", e.target.value)
              }
              style={{ width: "100%" }}
            />
          </Card>

          <Card title="Album Cover" locked={locks.cover}>
            {coverPreview ? (
              <img
                src={coverPreview}
                alt="cover"
                style={{ maxWidth: "100%", borderRadius: 12, marginBottom: 8 }}
              />
            ) : null}
            <input
              type="file"
              accept="image/*"
              disabled={locks.cover}
              onChange={(e) => updateCoverFile(e.target.files?.[0])}
            />
          </Card>

          <Card title="Locks">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <LockPill
                label="Playlist"
                locked={locks.playlist}
                onToggle={() => toggleLock("playlist")}
              />
              <LockPill
                label="Meta"
                locked={locks.meta}
                onToggle={() => toggleLock("meta")}
              />
              <LockPill
                label="Cover"
                locked={locks.cover}
                onToggle={() => toggleLock("cover")}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
