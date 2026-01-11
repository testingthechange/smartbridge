// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP — stored in snapshot, NOT shown in UI */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-LAYOUT-LOCKED-2COL-PLAYER-TOP-2026-01-10-Z";

/* ---- helpers ---- */
function normalizeBase(s) {
  return String(s || "")
    .trim()
    .replace(/\/+$/, "");
}

function safeName(name) {
  return String(name || "upload").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isoForKey() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function pickCatalogTitle(s, slot) {
  const tj = s?.titleJson;
  const fromJson = typeof tj === "object" ? String(tj?.title || "").trim() : "";
  const fromTitle = String(s?.title || "").trim();
  return fromJson || fromTitle || `Song ${slot}`;
}

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function moveItem(list, fromIdx, toIdx) {
  const out = [...list];
  const [x] = out.splice(fromIdx, 1);
  out.splice(toIdx, 0, x);
  return out;
}

function toSlotId(slot) {
  return `slot-${Number(slot)}`;
}
function fromSlotId(id) {
  const m = String(id || "").match(/^slot-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/* --------- UI bits --------- */
function Card({ title, right, children }) {
  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontSize: 16, fontWeight: 950 }}>{title}</div>
        {right ? <div>{right}</div> : null}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function LockPill({ locked, onToggle, disabled, label }) {
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      style={{
        padding: "7px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontWeight: 950,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        fontSize: 12,
        letterSpacing: 0.2,
        opacity: disabled ? 0.65 : 1,
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
      }}
      title="Toggle lock"
    >
      <span style={{ textTransform: "uppercase", opacity: 0.85 }}>{label}</span>
      <span style={{ fontFamily: styles.mono, fontSize: 12 }}>{locked ? "LOCKED" : "UNLOCKED"}</span>
    </button>
  );
}

export default function Album() {
  const params = useParams();
  const location = useLocation();

  const projectId = useMemo(() => {
    const fromParams = (params?.projectId || "").trim();
    if (fromParams) return fromParams;
    const sp = new URLSearchParams(location.search || "");
    return (sp.get("projectId") || "").trim();
  }, [params, location.search]);

  const API_BASE = useMemo(() => {
    return normalizeBase(import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE || "");
  }, []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  // locks (independent per-card)
  const [lockBusy, setLockBusy] = useState(false);
  const [locksUI, setLocksUI] = useState({
    playlistComplete: false,
    metaComplete: false,
    coverComplete: false,
  });

  // playlist order (drag/drop) — stored as slot ids: ["slot-1", ...]
  const [orderIds, setOrderIds] = useState(() => []);
  const dragFromIdxRef = useRef(-1);

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // master save
  const [msBusy, setMsBusy] = useState(false);
  const [msSavedAt, setMsSavedAt] = useState("");

  // cover preview url management
  const lastPreviewUrlRef = useRef("");

  // init guard
  const didInitRef = useRef(false);

  const playlistLocked = Boolean(locksUI.playlistComplete);
  const metaLocked = Boolean(locksUI.metaComplete);
  const coverLocked = Boolean(locksUI.coverComplete);

  function rereadProject() {
    return loadProject(projectId);
  }

  function getCatalogSongs(p) {
    return Array.isArray(p?.catalog?.songs) ? p.catalog.songs : [];
  }

  function buildDerivedPlaylistFromCatalog(p, order) {
    const catalogSongs = getCatalogSongs(p);
    const bySlot = new Map(
      catalogSongs.map((s) => [
        Number(s?.slot || s?.songNumber || 0),
        {
          slot: Number(s?.slot || s?.songNumber || 0),
          title: pickCatalogTitle(s, Number(s?.slot || s?.songNumber || 0)),
          s3Key: String(s?.files?.album?.s3Key || s?.files?.catalog?.s3Key || "").trim(),
          durationSeconds: Number(s?.durationSeconds || s?.duration || 0) || 0,
        },
      ])
    );

    const maxSlot = Math.max(9, catalogSongs.length || 0);

    const slots = Array.isArray(order) && order.length
      ? order
          .map(fromSlotId)
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxSlot)
      : Array.from({ length: maxSlot }, (_, i) => i + 1);

    const out = [];
    for (const slot of slots) {
      const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "", durationSeconds: 0, slot };
      out.push({
        trackNo: out.length + 1,
        sourceSlot: slot,
        title: c.title,
        durationSeconds: c.durationSeconds,
        file: { s3Key: c.s3Key },
      });
    }
    return out;
  }

  // INIT — create defaults only for brand-new projects; never overwrite existing ones
  useEffect(() => {
    if (!projectId) return;
    if (didInitRef.current) return;
    didInitRef.current = true;

    const stored = loadProject(projectId);

    const base =
      stored || {
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        catalog: { songs: [] },
        album: {
          songs: [],
          playlistOrder: [],
          locks: { playlistComplete: false, metaComplete: false, coverComplete: false },
          meta: { albumTitle: "", artistName: "", releaseDate: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
        },
      };

    const next = {
      ...base,
      album: {
        ...(base.album || {}),
        songs: Array.isArray(base.album?.songs) ? base.album.songs : [],
        playlistOrder: Array.isArray(base.album?.playlistOrder) ? base.album.playlistOrder : [],
        locks: {
          playlistComplete: false,
          metaComplete: false,
          coverComplete: false,
          ...(base.album?.locks || {}),
        },
        meta: {
          albumTitle: "",
          artistName: "",
          releaseDate: "",
          ...(base.album?.meta || {}),
        },
        cover: { s3Key: "", localPreviewUrl: "", ...(base.album?.cover || {}) },
      },
      updatedAt: new Date().toISOString(),
    };

    if (!stored) {
      saveProject(projectId, next);
      setProject(next);
    } else {
      setProject(stored);
    }
  }, [projectId]);

  // keep locksUI synced from persisted project on load/refresh
  useEffect(() => {
    const l = project?.album?.locks || {};
    setLocksUI({
      playlistComplete: parseLock(l.playlistComplete),
      metaComplete: parseLock(l.metaComplete),
      coverComplete: parseLock(l.coverComplete),
    });
  }, [project]);

  // keep orderIds synced from persisted project
  useEffect(() => {
    const po = Array.isArray(project?.album?.playlistOrder) ? project.album.playlistOrder : [];
    if (po.length) {
      setOrderIds(po);
      return;
    }

    // fallback: build default order from catalog length (or 9)
    const catalogSongs = getCatalogSongs(project);
    const maxSlot = Math.max(9, catalogSongs.length || 0);
    setOrderIds(Array.from({ length: maxSlot }, (_, i) => toSlotId(i + 1)));
  }, [project]);

  // audio events + continuous play
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTimeEv = () => setTime(a.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTimeEv);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);

    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTimeEv);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  // cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      const u = String(lastPreviewUrlRef.current || "");
      if (u.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      }
    };
  }, []);

  // playlist to render
  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked) {
      const snap = Array.isArray(project?.album?.songs) ? project.album.songs : [];
      return snap.map((t, i) => ({
        ...t,
        trackNo: i + 1,
        durationSeconds: Number(t?.durationSeconds || 0) || 0,
      }));
    }
    return buildDerivedPlaylistFromCatalog(project, orderIds);
  }, [project, playlistLocked, orderIds]);

  // keep activeIndex in range
  useEffect(() => {
    if (!playlist.length) return;
    if (activeIndex < 0) return;
    if (activeIndex >= playlist.length) setActiveIndex(playlist.length - 1);
  }, [playlist.length, activeIndex]);

  // continuous play (next when ended)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onEnded = () => {
      if (!playlist.length) return;
      const next = activeIndex + 1;
      if (next < playlist.length) playIndex(next);
      else {
        setIsPlaying(false);
        setActiveIndex(-1);
      }
    };

    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, playlist]);

  // toggle locks (independent per card)
  function toggleLock(lockKey) {
    if (lockBusy) return;
    setLockBusy(true);
    setErr("");

    try {
      const current = rereadProject() || project;
      if (!current) return;

      const wasLocked = parseLock(current?.album?.locks?.[lockKey]);
      const nextVal = !wasLocked;

      // UI flip immediately
      setLocksUI((prev) => ({ ...prev, [lockKey]: nextVal }));

      let nextAlbum = {
        ...(current?.album || {}),
        locks: { ...(current?.album?.locks || {}), [lockKey]: nextVal },
      };

      // when turning Playlist lock ON, snapshot the derived playlist into album.songs once
      if (lockKey === "playlistComplete" && nextVal === true) {
        const snap = buildDerivedPlaylistFromCatalog(current, orderIds);
        nextAlbum = {
          ...nextAlbum,
          songs: snap,
          playlistOrder: Array.isArray(orderIds) ? [...orderIds] : [],
        };
      }

      const next = {
        ...current,
        album: nextAlbum,
        updatedAt: new Date().toISOString(),
      };

      saveProject(projectId, next);
      setProject(next);
    } finally {
      setLockBusy(false);
    }
  }

  // drag/drop only when playlist unlocked
  function onDragStart(idx) {
    if (playlistLocked) return;
    dragFromIdxRef.current = idx;
  }
  function onDragOver(e) {
    if (playlistLocked) return;
    e.preventDefault();
  }
  function onDrop(idx) {
    if (playlistLocked) return;
    const from = dragFromIdxRef.current;
    dragFromIdxRef.current = -1;
    if (from < 0 || from === idx) return;

    const nextOrder = moveItem(orderIds, from, idx);
    setOrderIds(nextOrder);

    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: { ...(current.album || {}), playlistOrder: nextOrder },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  // album meta setters (locked by Meta lock)
  function setAlbumMetaField(key, value) {
    if (metaLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        meta: { ...(current?.album?.meta || {}), [key]: String(value || "") },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  // cover setters (locked by Cover lock)
  function setCoverS3Key(nextKey) {
    if (coverLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        cover: { ...(current?.album?.cover || {}), s3Key: String(nextKey || "").trim() },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  async function uploadCoverFile(file) {
    if (coverLocked) return;
    if (!file) return;
    setErr("");

    if (!API_BASE) {
      setErr("Missing VITE_BACKEND_URL (or VITE_API_BASE)");
      return;
    }

    // local preview first
    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(old);
      } catch {}
    }
    const url = URL.createObjectURL(file);
    lastPreviewUrlRef.current = url;

    // persist preview url
    {
      const current = rereadProject() || project;
      if (current) {
        const next = {
          ...current,
          album: {
            ...(current?.album || {}),
            cover: { ...(current?.album?.cover || {}), localPreviewUrl: url },
          },
          updatedAt: new Date().toISOString(),
        };
        saveProject(projectId, next);
        setProject(next);
      }
    }

    // upload to backend -> S3
    try {
      setBusy("Uploading cover…");
      const s3Key = `storage/projects/${projectId}/album/cover/${isoForKey()}__${safeName(file.name)}`;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("s3Key", s3Key);

      const r = await fetch(`${API_BASE}/api/upload-to-s3?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setCoverS3Key(String(j.s3Key || s3Key));
      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Cover upload failed");
    }
  }

  function clearCover() {
    if (coverLocked) return;

    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(old);
      } catch {}
    }
    lastPreviewUrlRef.current = "";

    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        cover: { ...(current?.album?.cover || {}), s3Key: "", localPreviewUrl: "" },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  async function playIndex(idx) {
    setErr("");
    if (!API_BASE) {
      setErr("Missing VITE_BACKEND_URL (or VITE_API_BASE)");
      return;
    }

    const item = playlist[idx];
    const s3Key = String(item?.file?.s3Key || "").trim();
    if (!s3Key) {
      setErr("Missing s3Key for this track.");
      return;
    }

    const seq = ++playSeq.current;
    setBusy("Loading…");

    try {
      const url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
      if (seq !== playSeq.current) return;

      const a = audioRef.current;
      if (!a) return;

      a.pause();
      a.currentTime = 0;
      a.src = url;
      a.load();
      await once(a, "canplay");

      if (seq !== playSeq.current) return;
      await a.play();

      setActiveIndex(idx);
      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Playback failed");
    }
  }

  function togglePlayPause() {
    const a = audioRef.current;
    if (!a) return;

    if (activeIndex < 0 && playlist.length) {
      playIndex(0);
      return;
    }

    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function prevTrack() {
    if (!playlist.length) return;
    const prev = activeIndex > 0 ? activeIndex - 1 : 0;
    playIndex(prev);
  }

  function nextTrack() {
    if (!playlist.length) return;
    const next = activeIndex + 1;
    if (next < playlist.length) playIndex(next);
  }

  // total album time (best-effort)
  const totalSeconds = useMemo(() => {
    return playlist.reduce((acc, t) => acc + (Number(t?.durationSeconds || 0) || 0), 0);
  }, [playlist]);

 // Master Save (2-tier confirm + final alert)
async function masterSaveAlbum() {
  if (msBusy) return;

  // 2-step confirmation
  const first = window.confirm("Are you sure you want to Master Save Album?\n\nThis writes the Album snapshot.");
  if (!first) return;

  const second = window.confirm("Last chance.\n\nDouble-check everything before saving.");
  if (!second) return;

  setMsBusy(true);
  setMsMsg("");
  setErr("");

  try {
    const current = rereadProject() || project;
    if (!current) {
      setMsMsg("No project loaded.");
      return;
    }

    const snapshotPlaylist = playlistLocked
      ? (Array.isArray(current?.album?.songs) ? current.album.songs : [])
      : buildAlbumPlaylistFromCatalog(current);

    const nowIso = new Date().toISOString();

    const snapshot = {
      buildStamp: ALBUM_BUILD_STAMP,
      savedAt: nowIso,
      projectId,
      locks: {
        playlistComplete: Boolean(locksUI.playlistComplete),
        metaComplete: Boolean(locksUI.metaComplete),
        coverComplete: Boolean(locksUI.coverComplete),
      },
      playlist: snapshotPlaylist,
      meta: { ...(current?.album?.meta || {}) },
      cover: { ...(current?.album?.cover || {}) },
    };

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        masterSave: snapshot,
      },
      updatedAt: nowIso,
    };

    saveProject(projectId, next);
    setProject(next);

    setMsMsg(`Album Master Saved @ ${nowIso}`);
    setMsArmed(false);

    // FINAL CONFIRMATION MESSAGE
    window.alert(`Master Save confirmed.\n\nAlbum Master Saved @ ${nowIso}`);
  } catch (e) {
    setErr(e?.message || "Master Save failed");
  } finally {
    setMsBusy(false);
  }
}

  try {
    const current = rereadProject() || project;
    if (!current) {
      setMsMsg("No project loaded.");
      return;
    }

    const nowIso = new Date().toISOString();

    // Snapshot playlist: if playlist is locked, use album.songs; else derive from catalog right now.
    const snapshotPlaylist = playlistLocked
      ? Array.isArray(current?.album?.songs)
        ? current.album.songs
        : []
      : buildAlbumPlaylistFromCatalog(current);

    // Album meta fields (keep existing note if you still use it elsewhere)
    const albumMeta = {
      albumTitle: String(current?.album?.meta?.albumTitle || ""),
      artistName: String(current?.album?.meta?.artistName || ""),
      releaseDate: String(current?.album?.meta?.releaseDate || ""),
      note: String(current?.album?.meta?.note || ""),
    };

    // Cover payload
    const albumCover = {
      s3Key: String(current?.album?.cover?.s3Key || ""),
      localPreviewUrl: String(current?.album?.cover?.localPreviewUrl || ""),
    };

    // Total time (best-effort; if you don’t store per-track seconds yet, keep 0)
    const albumTotalTimeSeconds = snapshotPlaylist.reduce((sum, t) => {
      const v = Number(t?.durationSeconds);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    // REQUIRED snapshot shape
    const snapshot = {
      buildStamp: ALBUM_BUILD_STAMP,
      savedAt: nowIso,
      projectId,
      locks: {
        playlistComplete: Boolean(current?.album?.locks?.playlistComplete),
        metaComplete: Boolean(current?.album?.locks?.metaComplete),
        coverComplete: Boolean(current?.album?.locks?.coverComplete),
        // If you added a separate cover-upload lock, include it here too:
        coverUploadComplete: Boolean(current?.album?.locks?.coverUploadComplete),
      },
      playlist: snapshotPlaylist,
      meta: albumMeta,
      cover: albumCover,
      albumTotalTimeSeconds,
    };

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        masterSave: snapshot,
      },
      updatedAt: nowIso,
    };

    saveProject(projectId, next);
    setProject(next);

    setMsMsg(`Album Master Saved @ ${nowIso}`);
    setMsArmed(false);

    window.alert("Album Master Save complete.\n\nSnapshot written to album.masterSave.");
  } catch (e) {
    setErr(e?.message || "Master Save failed");
  } finally {
    setMsBusy(false);
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const albumTitle = String(project?.album?.meta?.albumTitle || "");
  const artistName = String(project?.album?.meta?.artistName || "");
  const releaseDate = String(project?.album?.meta?.releaseDate || "");

  const coverKey = String(project?.album?.cover?.s3Key || "");
  const coverPreview = String(project?.album?.cover?.localPreviewUrl || "");

  const nowTrack = activeIndex >= 0 ? playlist[activeIndex] : null;

  return (
    <div style={{ maxWidth: 1100, padding: 18 }}>
      {/* Header Row (no build stamp) */}
      <div style={{ paddingBottom: 10, borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: 32, fontWeight: 950, color: "#0f172a" }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Project <b>{projectId}</b>
        </div>
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 900 }}>{err}</div> : null}

      {/* Two-Column Grid */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* (L1) PLAYER CARD */}
          <Card
            title="Player"
            right={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={prevTrack} style={styles.softBtn} title="Prev">
                  Prev
                </button>
                <button type="button" onClick={togglePlayPause} style={styles.primaryBtn} title="Play/Pause">
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={nextTrack} style={styles.softBtn} title="Next">
                  Next
                </button>
              </div>
            }
          >
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Now Playing:{" "}
              <span style={{ fontWeight: 900 }}>
                {nowTrack ? `${nowTrack.title || `Song ${nowTrack.sourceSlot}`}` : "—"}
              </span>
            </div>

            <div style={{ marginTop: 10 }}>
              <audio ref={audioRef} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.85 }}>
                  {fmtTime(time)} / {fmtTime(dur)}
                </div>
                <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.6 }}>
                  track {activeIndex >= 0 ? activeIndex + 1 : "—"} / {playlist.length || "—"}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, Math.floor(dur || 0))}
                value={Math.floor(time || 0)}
                onChange={(e) => {
                  const a = audioRef.current;
                  if (a) a.currentTime = Number(e.target.value || 0);
                }}
                style={{ width: "100%", marginTop: 8 }}
              />
            </div>
          </Card>

          {/* (L2) TRACKS + DRAG/DROP CARD */}
          <Card
            title="Tracks"
            right={<LockPill locked={playlistLocked} onToggle={() => toggleLock("playlistComplete")} disabled={lockBusy} label="Playlist" />}
          >
            <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
              {playlistLocked ? "LOCKED — drag & drop disabled." : "UNLOCKED — drag & drop enabled."}
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {playlist.map((t, i) => {
                const active = i === activeIndex;
                const durS = Number(t?.durationSeconds || 0) || 0;

                return (
                  <div
                    key={`${t.sourceSlot}-${i}`}
                    draggable={!playlistLocked}
                    onDragStart={() => onDragStart(i)}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(i)}
                    onClick={() => playIndex(i)}
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      background: active ? "rgba(59,130,246,0.08)" : "#fff",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      userSelect: "none",
                    }}
                    title={playlistLocked ? "Locked" : "Drag to reorder"}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {i + 1}. {t.title || `Song ${t.sourceSlot}`}
                      </div>
                      <div style={{ marginTop: 3, fontFamily: styles.mono, fontSize: 11, opacity: 0.65 }}>
                        slot-{t.sourceSlot}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flex: "0 0 auto" }}>
                      <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.85 }}>
                        {durS > 0 ? fmtTime(durS) : "—"}
                      </div>
                      {!playlistLocked ? (
                        <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.5 }}>≡</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* (R1) ALBUM META CARD */}
          <Card
            title="Album Meta"
            right={<LockPill locked={metaLocked} onToggle={() => toggleLock("metaComplete")} disabled={lockBusy} label="Meta" />}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={styles.fieldLabel}>Album Title</div>
                <input
                  value={albumTitle}
                  disabled={metaLocked}
                  onChange={(e) => setAlbumMetaField("albumTitle", e.target.value)}
                  style={metaLocked ? styles.inputDisabled : styles.input}
                  placeholder="Album title"
                />
              </div>

              <div>
                <div style={styles.fieldLabel}>Artist Name</div>
                <input
                  value={artistName}
                  disabled={metaLocked}
                  onChange={(e) => setAlbumMetaField("artistName", e.target.value)}
                  style={metaLocked ? styles.inputDisabled : styles.input}
                  placeholder="Artist name"
                />
              </div>

              <div>
                <div style={styles.fieldLabel}>Release Date</div>
                <input
                  value={releaseDate}
                  disabled={metaLocked}
                  onChange={(e) => setAlbumMetaField("releaseDate", e.target.value)}
                  style={metaLocked ? styles.inputDisabled : styles.input}
                  placeholder="YYYY-MM-DD"
                />
              </div>

              <div>
                <div style={styles.fieldLabel}>Total Album Time</div>
                <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
                  {totalSeconds > 0 ? fmtTime(totalSeconds) : "—"}
                </div>
              </div>
            </div>
          </Card>

          {/* (R2) COVER UPLOAD CARD */}
          <Card
            title="Cover"
            right={<LockPill locked={coverLocked} onToggle={() => toggleLock("coverComplete")} disabled={lockBusy} label="Cover" />}
          >
            <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
              {coverLocked ? "LOCKED — cover changes disabled." : "Upload a cover image (uploads to S3 via backend)."}
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div>
                <div style={styles.fieldLabel}>Cover s3Key</div>
                <input
                  value={coverKey}
                  disabled={coverLocked}
                  onChange={(e) => setCoverS3Key(e.target.value)}
                  style={coverLocked ? styles.inputDisabled : styles.input}
                  placeholder="(auto-filled after upload)"
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="file"
                  accept="image/*"
                  disabled={coverLocked}
                  onChange={(e) => uploadCoverFile(e.target.files?.[0] || null)}
                />
                <button type="button" onClick={clearCover} disabled={coverLocked} style={coverLocked ? styles.softBtnDisabled : styles.softBtn}>
                  Clear
                </button>
              </div>

              {coverPreview ? (
                <div>
                  <img
                    src={coverPreview}
                    alt="cover preview"
                    style={{ maxWidth: 320, width: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }}
                  />
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {/* Master Save — NOT in a card (button lower right) */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Master Save</div>
            <div style={{ marginTop: 6, fontFamily: styles.mono, fontSize: 12, opacity: 0.8 }}>
              {project?.album?.masterSave?.savedAt ? `Album Master Saved @ ${project.album.masterSave.savedAt}` : "—"}
          </div>

          <button
            type="button"
            onClick={masterSaveAlbum}
            disabled={msBusy}
            style={msBusy ? styles.primaryBtnDisabled : styles.primaryBtn}
            title="Master Save"
          >
            Master Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */
const styles = {
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  card: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 },
  fieldLabel: { fontSize: 11, fontWeight: 950, opacity: 0.7, textTransform: "uppercase", marginBottom: 6 },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontSize: 13,
    outline: "none",
  },

  inputDisabled: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    fontSize: 13,
    outline: "none",
    cursor: "not-allowed",
  },

  softBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontSize: 12,
    fontWeight: 950,
    cursor: "pointer",
  },

  softBtnDisabled: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    fontSize: 12,
    fontWeight: 950,
    cursor: "not-allowed",
  },

  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },

  primaryBtnDisabled: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    fontSize: 13,
    fontWeight: 950,
    cursor: "not-allowed",
  },
};
