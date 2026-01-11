// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP — MUST APPEAR IN UI */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-NOPOPUPS-LOCKSWITCH-LOCALUI-2026-01-08";

/* ---- helpers ---- */
function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function pickCatalogTitle(s, slot) {
  const tj = s?.titleJson;
  const fromJson = typeof tj === "object" ? String(tj?.title || "").trim() : "";
  const fromTitle = String(s?.title || "").trim();
  return fromJson || fromTitle || `Song ${slot}`;
}

function buildAlbumPlaylistFromCatalog(project, orderedSlots) {
  const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const bySlot = new Map(
    catalogSongs.map((s) => [
      Number(s?.slot || s?.songNumber || 0),
      {
        title: pickCatalogTitle(s, Number(s?.slot || s?.songNumber || 0)),
        s3Key: String(s?.files?.album?.s3Key || s?.files?.album?.key || "").trim(),
        durationSec: Number(s?.files?.album?.durationSec || s?.durationSec || 0) || 0,
      },
    ])
  );

  const slots =
    Array.isArray(orderedSlots) && orderedSlots.length
      ? orderedSlots.filter((n) => Number.isFinite(Number(n))).map((n) => Number(n))
      : Array.from({ length: Math.max(9, catalogSongs.length || 0) }, (_, i) => i + 1);

  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "", durationSec: 0 };
    out.push({
      trackNo: i + 1,
      sourceSlot: slot,
      title: c.title,
      durationSec: c.durationSec || 0,
      file: { s3Key: c.s3Key },
    });
  }
  return out;
}

function sumDurationSec(list) {
  if (!Array.isArray(list)) return 0;
  return list.reduce((acc, t) => acc + (Number(t?.durationSec || 0) || 0), 0);
}

/* --------- UI bits --------- */
function LockPill({ label, locked, onToggle, note, disabled }) {
  // green = UNLOCKED, red = LOCKED
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: bg,
          color,
          fontWeight: 950,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          userSelect: "none",
        }}
        title="Toggle lock"
      >
        <span style={{ fontSize: 12, letterSpacing: 0.2, textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
          {locked ? "LOCKED" : "UNLOCKED"}
        </span>
      </button>

      {note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
    </div>
  );
}

function Card({ title, right, children }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 950 }}>{title}</div>
        {right || null}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function ReadonlyBox({ title, children }) {
  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 10,
        border: "1px solid #ddd",
        padding: 10,
        background: "#f8fafc",
        opacity: 0.95,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: "#991b1b", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

/* ---------------- Drag + Drop ---------------- */
function moveItem(arr, fromIdx, toIdx) {
  const a = Array.isArray(arr) ? [...arr] : [];
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= a.length || toIdx >= a.length) return a;
  const [item] = a.splice(fromIdx, 1);
  a.splice(toIdx, 0, item);
  return a;
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

  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // guard against rapid toggles / re-entry
  const [lockBusy, setLockBusy] = useState(false);

  // UI-driven lock state (guarantees red<->green flip immediately)
  const [locksUI, setLocksUI] = useState({
    playlistComplete: false,
    metaComplete: false,
    coverComplete: false,
    coverUploadComplete: false,
  });

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // cover preview url management
  const lastPreviewUrlRef = useRef("");

  // init guard
  const didInitRef = useRef(false);

  // drag state
  const [dragIndex, setDragIndex] = useState(-1);

  // drive pill colors from local UI state
  const playlistLocked = Boolean(locksUI.playlistComplete);
  const metaLocked = Boolean(locksUI.metaComplete);
  const coverLocked = Boolean(locksUI.coverComplete);
  const coverUploadLocked = Boolean(locksUI.coverUploadComplete);

  const orderedSlots = useMemo(() => {
    const po = project?.album?.playlistOrder;
    if (Array.isArray(po) && po.length) {
      // accept either [1..] or ["slot-1"..]
      const slots = po
        .map((x) => {
          const s = String(x);
          const m = s.match(/^slot-(\d+)$/);
          return m ? Number(m[1]) : Number(x);
        })
        .filter((n) => Number.isFinite(n) && n >= 1);
      if (slots.length) return slots;
    }
    return [];
  }, [project]);

  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked) return Array.isArray(project?.album?.songs) ? project.album.songs : [];
    return buildAlbumPlaylistFromCatalog(project, orderedSlots);
  }, [project, playlistLocked, orderedSlots]);

  const albumTotalSec = useMemo(() => sumDurationSec(playlist), [playlist]);

  function rereadProject() {
    return loadProject(projectId);
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
          locks: { playlistComplete: false, metaComplete: false, coverComplete: false, coverUploadComplete: false },
          meta: { note: "", albumTitle: "", artistName: "", releaseDate: "" },
          cover: { s3Key: "", localPreviewUrl: "", fileName: "" },
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
          coverUploadComplete: false,
          ...(base.album?.locks || {}),
        },
        meta: { note: "", albumTitle: "", artistName: "", releaseDate: "", ...(base.album?.meta || {}) },
        cover: { s3Key: "", localPreviewUrl: "", fileName: "", ...(base.album?.cover || {}) },
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
      coverUploadComplete: parseLock(l.coverUploadComplete),
    });
  }, [project]);

  // audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTimeEv = () => setTime(a.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      // auto-advance in playlist order
      const nextIdx = activeIndex + 1;
      if (nextIdx >= 0 && nextIdx < playlist.length) playIndex(nextIdx);
    };

    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTimeEv);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTimeEv);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, playlist]);

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

  // Special rule: when turning Playlist lock ON, snapshot derived playlist into album.songs once.
  function toggleLock(lockKey) {
    if (lockBusy) return;
    setLockBusy(true);
    setErr("");

    try {
      // 1) flip UI immediately so pill always changes color
      setLocksUI((prev) => ({ ...prev, [lockKey]: !Boolean(prev?.[lockKey]) }));

      // 2) persist to storage + state
      const current = rereadProject() || project;
      if (!current) return;

      const wasLocked = parseLock(current?.album?.locks?.[lockKey]);
      const nextVal = !wasLocked;

      let nextAlbum = {
        ...(current?.album || {}),
        locks: { ...(current?.album?.locks || {}), [lockKey]: nextVal },
      };

      if (lockKey === "playlistComplete" && nextVal === true) {
        const snap = buildAlbumPlaylistFromCatalog(current, orderedSlots);
        // also snapshot order
        const order = snap.map((t) => Number(t.sourceSlot));
        nextAlbum = { ...nextAlbum, songs: snap, playlistOrder: order.map((n) => `slot-${n}`) };
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

  function persistPlaylistOrderFromList(nextList) {
    const current = rereadProject() || project;
    if (!current) return;

    const orderSlots = nextList.map((t) => Number(t?.sourceSlot)).filter((n) => Number.isFinite(n) && n >= 1);
    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        playlistOrder: orderSlots.map((n) => `slot-${n}`),
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function onDragStart(i) {
    if (playlistLocked) return; // gated by Playlist lock only
    setDragIndex(i);
  }
  function onDragOver(e) {
    if (playlistLocked) return;
    e.preventDefault();
  }
  function onDrop(i) {
    if (playlistLocked) return;
    if (dragIndex < 0) return;

    const nextList = moveItem(playlist, dragIndex, i);
    setDragIndex(-1);
    persistPlaylistOrderFromList(nextList);
  }

  async function masterSaveAlbum() {
    if (!projectId) return;

    const first = window.confirm("Are you sure you want to perform a Master Save from Album?");
    if (!first) return;

    const second = window.confirm("Last chance.\n\nDouble check everything before saving.");
    if (!second) return;

    setErr("");
    setBusy("Saving…");

    try {
      const current = rereadProject() || project;
      if (!current) throw new Error("No project loaded.");

      // Snapshot playlist/meta/cover regardless of locks
      const snapshotPlaylist = playlistLocked
        ? Array.isArray(current?.album?.songs)
          ? current.album.songs
          : []
        : buildAlbumPlaylistFromCatalog(current, orderedSlots);

      const savedAt = new Date().toISOString();

      // ✅ Correct snapshot format (stable + minimal; no UI-only fields)
      const snapshot = {
        buildStamp: ALBUM_BUILD_STAMP,
        savedAt,
        projectId,
        locks: {
          playlistComplete: Boolean(locksUI.playlistComplete),
          metaComplete: Boolean(locksUI.metaComplete),
          coverComplete: Boolean(locksUI.coverComplete),
          coverUploadComplete: Boolean(locksUI.coverUploadComplete),
        },
        playlistOrder: snapshotPlaylist.map((t) => `slot-${Number(t.sourceSlot)}`),
        playlist: snapshotPlaylist.map((t, idx) => ({
          trackNo: idx + 1,
          sourceSlot: Number(t.sourceSlot),
          title: String(t.title || ""),
          durationSec: Number(t.durationSec || 0) || 0,
          file: { s3Key: String(t?.file?.s3Key || "").trim() },
        })),
        meta: {
          albumTitle: String(current?.album?.meta?.albumTitle || ""),
          artistName: String(current?.album?.meta?.artistName || ""),
          releaseDate: String(current?.album?.meta?.releaseDate || ""),
          note: String(current?.album?.meta?.note || ""),
          totalDurationSec: Number(albumTotalSec || 0) || 0,
        },
        cover: {
          s3Key: String(current?.album?.cover?.s3Key || ""),
          fileName: String(current?.album?.cover?.fileName || ""),
        },
      };

      const nextProject = {
        ...current,
        album: {
          ...(current?.album || {}),
          masterSave: snapshot,
        },
        updatedAt: savedAt,
      };

      // local persist
      saveProject(projectId, nextProject);
      setProject(nextProject);

      // backend persist (if configured)
      if (!API_BASE) {
        setBusy("");
        window.alert(`Album Master Save complete.\n\nSaved locally only (missing VITE_API_BASE).`);
        return;
      }

      const r = await fetch(`${API_BASE}/api/master-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, project: nextProject }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setBusy("");
      window.alert(`Album Master Save complete.\n\nSaved @ ${savedAt}`);
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Master Save failed");
    }
  }

  function setAlbumField(key, value) {
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

  function setMetaNote(nextNote) {
    setAlbumField("note", nextNote);
  }

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

  function setCoverLocalPreview(file) {
    if (coverLocked || coverUploadLocked) return;
    if (!file) return;

    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(old);
      } catch {}
    }

    const url = URL.createObjectURL(file);
    lastPreviewUrlRef.current = url;

    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        cover: { ...(current?.album?.cover || {}), localPreviewUrl: url, fileName: String(file.name || "") },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function clearCover() {
    if (coverLocked || coverUploadLocked) return;

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
        cover: { ...(current?.album?.cover || {}), s3Key: "", localPreviewUrl: "", fileName: "" },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  async function playIndex(idx) {
    setErr("");
    if (!API_BASE) {
      setErr("Missing VITE_API_BASE");
      return;
    }

    const item = playlist[idx];
    const s3Key = String(item?.file?.s3Key || "").trim();
    if (!s3Key) return;

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
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function playPrev() {
    if (!playlist.length) return;
    const i = activeIndex <= 0 ? 0 : activeIndex - 1;
    playIndex(i);
  }
  function playNext() {
    if (!playlist.length) return;
    const i = activeIndex < 0 ? 0 : Math.min(playlist.length - 1, activeIndex + 1);
    playIndex(i);
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const albumTitle = String(project?.album?.meta?.albumTitle || "");
  const artistName = String(project?.album?.meta?.artistName || "");
  const releaseDate = String(project?.album?.meta?.releaseDate || "");
  const metaNote = String(project?.album?.meta?.note || "");

  const coverKey = String(project?.album?.cover?.s3Key || "");
  const coverPreview = String(project?.album?.cover?.localPreviewUrl || "");
  const coverFileName = String(project?.album?.cover?.fileName || "");

  const msSavedAt = String(project?.album?.masterSave?.savedAt || "");

  return (
    <div style={{ maxWidth: 1200, padding: 18 }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid #ddd" }}>
        <div style={{ fontSize: 32, fontWeight: 900 }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Project <b>{projectId}</b> · Build <code>{ALBUM_BUILD_STAMP}</code>
        </div>
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "crimson", fontWeight: 900 }}>{err}</div> : null}

      {/* Locks row (unchanged behavior) */}
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <LockPill
          label="Playlist"
          locked={playlistLocked}
          onToggle={() => toggleLock("playlistComplete")}
          disabled={lockBusy}
          note="Unlocked = derived from Catalog + draggable order. Locked = snapshot saved (DnD disabled)."
        />
        <LockPill
          label="Meta"
          locked={metaLocked}
          onToggle={() => toggleLock("metaComplete")}
          disabled={lockBusy}
          note="Locks album meta edits (read-only when locked)."
        />
        <LockPill
          label="Cover Key"
          locked={coverLocked}
          onToggle={() => toggleLock("coverComplete")}
          disabled={lockBusy}
          note="Locks cover s3Key edits (read-only when locked)."
        />
        <LockPill
          label="Cover Upload"
          locked={coverUploadLocked}
          onToggle={() => toggleLock("coverUploadComplete")}
          disabled={lockBusy}
          note="Locks cover file upload/preview (read-only when locked)."
        />
      </div>

      {/* Two-column layout (LOCKED): LEFT = player top + tracks below; RIGHT = meta + cover */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14, alignItems: "start" }}>
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Card 1: Player (MOVED TO TOP as requested) */}
          <Card
            title="Player"
            right={
              <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
                {fmtTime(time)} / {fmtTime(dur)}
              </div>
            }
          >
            <audio ref={audioRef} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={playPrev} style={btn()}>
                Prev
              </button>
              <button type="button" onClick={togglePlayPause} style={btnPrimary()}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button type="button" onClick={playNext} style={btn()}>
                Next
              </button>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {activeIndex >= 0 ? (
                  <>
                    Now: <b>Track {activeIndex + 1}</b> — {playlist?.[activeIndex]?.title || "—"}
                  </>
                ) : (
                  "Click a track to play"
                )}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, Math.floor(dur || 0))}
                value={Math.floor(time || 0)}
                onChange={(e) => {
                  const a = audioRef.current;
                  if (a) a.currentTime = Number(e.target.value || 0);
                }}
                style={{ width: "100%" }}
              />
            </div>
          </Card>

          {/* Card 2: Tracks */}
          <Card
            title="Tracks"
            right={
              <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
                total={fmtTime(albumTotalSec)}
              </div>
            }
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
              {playlistLocked ? "LOCKED — order is fixed (DnD disabled)." : "UNLOCKED — drag tracks to arrange playlist."}
            </div>

            {playlist.map((t, i) => {
              const isActive = i === activeIndex;
              const isDragOn = !playlistLocked;

              return (
                <div
                  key={`${t.sourceSlot}-${i}`}
                  draggable={isDragOn}
                  onDragStart={() => onDragStart(i)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(i)}
                  onClick={() => playIndex(i)}
                  style={{
                    padding: 10,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    marginBottom: 8,
                    background: isActive ? "rgba(59,130,246,0.08)" : "#fff",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    opacity: isDragOn ? 1 : 0.95,
                    userSelect: "none",
                  }}
                  title={isDragOn ? "Drag to reorder (Playlist must be UNLOCKED)" : "Playlist LOCKED"}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 950 }}>
                      Track {i + 1}: {t.title || `Song ${t.sourceSlot}`}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                      slot-{t.sourceSlot}
                      {t?.file?.s3Key ? "" : " · (no s3Key)"}
                    </div>
                  </div>

                  <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75, whiteSpace: "nowrap" }}>
                    {t?.durationSec ? fmtTime(Number(t.durationSec) || 0) : "—"}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* Meta card */}
          <Card
            title="Album Meta"
            right={<div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>locked={String(metaLocked)}</div>}
          >
            {metaLocked ? (
              <ReadonlyBox title="LOCKED — Album Meta is read-only">
                <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
                  albumTitle: {albumTitle || "—"}
                  <br />
                  artistName: {artistName || "—"}
                  <br />
                  releaseDate: {releaseDate || "—"}
                  <br />
                  totalTime: {fmtTime(albumTotalSec)}
                  <br />
                  note:
                  <pre style={{ margin: "6px 0 0 0", whiteSpace: "pre-wrap" }}>{metaNote || "—"}</pre>
                </div>
              </ReadonlyBox>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <Field label="Album title" value={albumTitle} onChange={(v) => setAlbumField("albumTitle", v)} />
                <Field label="Artist name" value={artistName} onChange={(v) => setAlbumField("artistName", v)} />
                <Field label="Release date" value={releaseDate} onChange={(v) => setAlbumField("releaseDate", v)} />
                <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75 }}>
                  totalTime: {fmtTime(albumTotalSec)}
                </div>
                <textarea
                  value={metaNote}
                  onChange={(e) => setMetaNote(e.target.value)}
                  placeholder="Album note"
                  style={{
                    width: "100%",
                    minHeight: 90,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    padding: 10,
                  }}
                />
              </div>
            )}
          </Card>

          {/* Cover card */}
          <Card
            title="Album Cover"
            right={
              <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
                keyLocked={String(coverLocked)} · uploadLocked={String(coverUploadLocked)}
              </div>
            }
          >
            {coverLocked ? (
              <ReadonlyBox title="LOCKED — Cover Key is read-only">
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>s3Key: {coverKey || "—"}</div>
              </ReadonlyBox>
            ) : (
              <input
                value={coverKey}
                onChange={(e) => setCoverS3Key(e.target.value)}
                placeholder="Paste cover s3Key here"
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  padding: 10,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
            )}

            <div style={{ marginTop: 10 }}>
              {coverUploadLocked ? (
                <ReadonlyBox title="LOCKED — Cover Upload is read-only">
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                    fileName: {coverFileName || "—"}
                    <br />
                    preview: {coverPreview ? "available" : "—"}
                  </div>
                </ReadonlyBox>
              ) : (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="file" accept="image/*" onChange={(e) => setCoverLocalPreview(e.target.files?.[0] || null)} />
                  <button type="button" onClick={clearCover} style={btn()}>
                    Clear
                  </button>
                  {coverFileName ? <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75 }}>{coverFileName}</div> : null}
                </div>
              )}
            </div>

            {coverPreview ? (
              <div style={{ marginTop: 10 }}>
                <img
                  src={coverPreview}
                  alt="cover preview"
                  style={{ width: "100%", maxWidth: 420, borderRadius: 14, border: "1px solid #e5e7eb" }}
                />
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      {/* Master Save (NOT in a card). Two-tier confirms + final confirmation alert */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 950 }}>Master Save</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75 }}>
            {msSavedAt ? `Album Master Saved @ ${msSavedAt}` : "—"}
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={masterSaveAlbum} style={btnPrimary()}>
            Master Save
          </button>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Writes <code>album.masterSave</code> (playlist/meta/cover/locks/buildStamp) and posts full project to{" "}
            <code>/api/master-save</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- small components + styles ---------------- */

function Field({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" }}>{label}</div>
      <input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          marginTop: 6,
          borderRadius: 12,
          border: "1px solid #ddd",
          padding: 10,
          fontSize: 13,
        }}
      />
    </div>
  );
}

function btn() {
  return {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #ddd",
    background: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  };
}

function btnPrimary() {
  return {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  };
}
