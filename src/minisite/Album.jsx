// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";
import { masterSaveMiniSite } from "../lib/masterSaveMiniSite.js";

/* BUILD STAMP — used in snapshot (NOT shown in UI) */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-LAYOUT-LOCKED-DND-PLAYER-2026-01-11-B";

/* ---- helpers ---- */
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
  const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const bySlot = new Map(
    catalogSongs.map((s) => [
      Number(s?.slot || s?.songNumber || 0),
      {
        title: pickCatalogTitle(s, Number(s?.slot || s?.songNumber || 0)),
        s3Key: String(s?.files?.album?.s3Key || "").trim(),
      },
    ])
  );

  const maxSlot = Math.max(9, catalogSongs.length || 0);
  const out = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "" };
    out.push({
      trackNo: out.length + 1,
      sourceSlot: slot,
      title: c.title,
      file: { s3Key: c.s3Key },
    });
  }
  return out;
}

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Failed to read file."));
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

/* --------- UI bits --------- */
function LockPill({ label, locked, onToggle, disabled, note }) {
  // green = UNLOCKED, red = LOCKED
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
        <span style={{ fontFamily: styles.mono, fontSize: 12 }}>{locked ? "LOCKED" : "UNLOCKED"}</span>
      </button>
      {note ? <div style={{ fontSize: 12, opacity: 0.72 }}>{note}</div> : null}
    </div>
  );
}

function ReadonlyBox({ title, children }) {
  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        padding: 12,
        background: "#f8fafc",
        opacity: 0.98,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: "#991b1b", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
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

  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  // guard against rapid toggles / re-entry
  const [lockBusy, setLockBusy] = useState(false);

  // UI-driven lock state (immediate pill color flip)
  const [locksUI, setLocksUI] = useState({
    playlistComplete: false,
    metaComplete: false,
    coverComplete: false,
  });

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  // drag state
  const dragFromRef = useRef(null);

  // cover preview url management
  const lastPreviewUrlRef = useRef("");

  // Master Save (2-tier confirm + final alert)
  const [msBusy, setMsBusy] = useState(false);

  // init guard
  const didInitRef = useRef(false);

  const playlistLocked = Boolean(locksUI.playlistComplete);
  const metaLocked = Boolean(locksUI.metaComplete);
  const coverLocked = Boolean(locksUI.coverComplete);

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
          playlistOrder: Array.from({ length: 9 }, (_, i) => i + 1),
          locks: { playlistComplete: false, metaComplete: false, coverComplete: false },
          meta: { albumTitle: "", artistName: "", releaseDate: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
          masterSave: null,
        },
      };

    const next = {
      ...base,
      album: {
        ...(base.album || {}),
        songs: Array.isArray(base.album?.songs) ? base.album.songs : [],
        playlistOrder: Array.isArray(base.album?.playlistOrder)
          ? base.album.playlistOrder
          : Array.from({ length: 9 }, (_, i) => i + 1),
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
        masterSave: base.album?.masterSave || null,
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
      // continuous play: advance
      nextTrack();
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
  }, [activeIndex]);

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

  // compute base playlist from catalog
  const baseCatalogPlaylist = useMemo(() => {
    if (!project) return [];
    return buildAlbumPlaylistFromCatalog(project);
  }, [project]);

  // ensure playlistOrder exists and is sane
  const playlistOrder = useMemo(() => {
    const order = Array.isArray(project?.album?.playlistOrder) ? project.album.playlistOrder : [];
    const cleaned = order
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .slice(0, 99);
    if (cleaned.length) return cleaned;
    return baseCatalogPlaylist.map((t) => Number(t.sourceSlot));
  }, [project, baseCatalogPlaylist]);

  // playlist shown (order applied)
  const playlist = useMemo(() => {
    if (!project) return [];

    // map slot -> latest title+s3Key from catalog
    const bySlot = new Map(baseCatalogPlaylist.map((t) => [Number(t.sourceSlot), t]));

    // build in order; if locked and we have snapshot songs, prefer snapshot titles/s3Keys but still order by playlistOrder
    const snapSongs = Array.isArray(project?.album?.songs) ? project.album.songs : [];
    const snapBySlot = new Map(snapSongs.map((t) => [Number(t.sourceSlot), t]));

    const out = [];
    for (const slot of playlistOrder) {
      const s = Number(slot);
      const fromSnap = playlistLocked ? snapBySlot.get(s) : null;
      const fromCatalog = bySlot.get(s);
      const best = fromSnap || fromCatalog || { sourceSlot: s, title: `Song ${s}`, file: { s3Key: "" } };
      out.push({
        trackNo: out.length + 1,
        sourceSlot: Number(best.sourceSlot || s),
        title: String(best.title || `Song ${s}`),
        file: { s3Key: String(best?.file?.s3Key || "") },
      });
    }

    // append any catalog slots not in order (rare)
    const seen = new Set(out.map((x) => Number(x.sourceSlot)));
    for (const t of baseCatalogPlaylist) {
      const s = Number(t.sourceSlot);
      if (!seen.has(s)) {
        out.push({
          trackNo: out.length + 1,
          sourceSlot: s,
          title: String(t.title || `Song ${s}`),
          file: { s3Key: String(t?.file?.s3Key || "") },
        });
      }
    }

    return out;
  }, [project, baseCatalogPlaylist, playlistOrder, playlistLocked]);

  const totalSeconds = useMemo(() => {
    // Album total time is known only if we have per-track durations; we do not.
    // Keep 0 and show "—" in UI.
    return 0;
  }, []);

  function persistProject(next) {
    saveProject(projectId, next);
    setProject(next);
  }

  // toggle locks (independent per-card)
  function toggleLock(lockKey) {
    if (lockBusy) return;
    setLockBusy(true);
    setErr("");

    try {
      // flip UI immediately
      setLocksUI((prev) => ({ ...prev, [lockKey]: !Boolean(prev?.[lockKey]) }));

      const current = rereadProject() || project;
      if (!current) return;

      const wasLocked = parseLock(current?.album?.locks?.[lockKey]);
      const nextVal = !wasLocked;

      let nextAlbum = {
        ...(current?.album || {}),
        locks: { ...(current?.album?.locks || {}), [lockKey]: nextVal },
      };

      // when turning Playlist lock ON: snapshot current arranged playlist into album.songs
      if (lockKey === "playlistComplete" && nextVal === true) {
        nextAlbum = {
          ...nextAlbum,
          songs: Array.isArray(playlist) ? playlist : [],
          playlistOrder: Array.isArray(playlistOrder) ? playlistOrder : [],
        };
      }

      const next = {
        ...current,
        album: nextAlbum,
        updatedAt: new Date().toISOString(),
      };
      persistProject(next);
    } finally {
      setLockBusy(false);
    }
  }

  // DnD helpers (gated ONLY by Playlist lock)
  function onDragStart(idx) {
    if (playlistLocked) return;
    dragFromRef.current = idx;
  }

  function onDragOver(e) {
    if (playlistLocked) return;
    e.preventDefault();
  }

  function onDrop(toIdx) {
    if (playlistLocked) return;

    const fromIdx = dragFromRef.current;
    dragFromRef.current = null;
    if (fromIdx == null || fromIdx === toIdx) return;

    const current = rereadProject() || project;
    if (!current) return;

    const order = [...playlistOrder];
    const moved = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, moved);

    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        playlistOrder: order,
      },
      updatedAt: new Date().toISOString(),
    };
    persistProject(next);

    // keep activeIndex tracking the same song slot if it was moved
    const nowSlot = playlist[fromIdx]?.sourceSlot;
    if (Number.isFinite(Number(nowSlot))) {
      const newIndex = order.findIndex((x) => Number(x) === Number(nowSlot));
      if (newIndex >= 0) setActiveIndex(newIndex);
    }
  }

  // meta setters (gated by Meta lock)
  function setAlbumMetaField(key, value) {
    if (metaLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        meta: {
          ...(current.album?.meta || {}),
          [key]: String(value ?? ""),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    persistProject(next);
  }

  // cover setters (gated by Cover lock)
  function setCoverS3Key(nextKey) {
    if (coverLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        cover: { ...(current.album?.cover || {}), s3Key: String(nextKey || "").trim() },
      },
      updatedAt: new Date().toISOString(),
    };
    persistProject(next);
  }

  async function uploadCoverFile(file) {
    if (coverLocked) return;
    if (!file) return;

    setErr("");

    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(old);
      } catch {}
    }

    try {
      // Store a persistent data URL so preview does not vanish after toggles/navigation/reload.
      const dataUrl = await readFileAsDataUrl(file);
      lastPreviewUrlRef.current = dataUrl;

      const current = rereadProject() || project;
      if (!current) return;

      const next = {
        ...current,
        album: {
          ...(current.album || {}),
          cover: { ...(current.album?.cover || {}), localPreviewUrl: dataUrl },
        },
        updatedAt: new Date().toISOString(),
      };
      persistProject(next);
    } catch (e) {
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
        ...(current.album || {}),
        cover: { ...(current.album?.cover || {}), s3Key: "", localPreviewUrl: "" },
      },
      updatedAt: new Date().toISOString(),
    };
    persistProject(next);
  }

  async function playIndex(idx) {
    setErr("");
    if (!API_BASE) {
      setErr("Missing VITE_API_BASE");
      return;
    }

    const item = playlist[idx];
    if (!item) return;

    const s3Key = String(item?.file?.s3Key || "").trim();
    if (!s3Key) {
      setErr("No s3Key for this track.");
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

    if (a.paused) {
      // if nothing loaded yet, start first track
      if (!a.src && playlist.length) {
        playIndex(Math.max(0, activeIndex >= 0 ? activeIndex : 0));
        return;
      }
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }

  function prevTrack() {
    if (!playlist.length) return;
    const nextIdx = activeIndex > 0 ? activeIndex - 1 : 0;
    playIndex(nextIdx);
  }

  function nextTrack() {
    if (!playlist.length) return;
    const nextIdx = activeIndex >= 0 ? activeIndex + 1 : 0;
    if (nextIdx >= playlist.length) return;
    playIndex(nextIdx);
  }

  // Master Save snapshot (correct shape) + 2-tier confirm + final alert
  async function masterSaveAlbum() {
    console.log("ALBUM MASTER SAVE CLICKED");

    if (msBusy) return;

    const first = window.confirm("Are you sure you want to Master Save Album?\n\nThis writes the Album snapshot.");
    if (!first) return;

    const second = window.confirm("Last chance.\n\nDouble-check everything before saving.");
    if (!second) return;

    setMsBusy(true);
    setErr("");

    try {
      const current = rereadProject() || project;
      if (!current) throw new Error("No project loaded.");

      const snap = {
        buildStamp: ALBUM_BUILD_STAMP,
        savedAt: new Date().toISOString(),
        projectId,
        locks: {
          playlistComplete: Boolean(locksUI.playlistComplete),
          metaComplete: Boolean(locksUI.metaComplete),
          coverComplete: Boolean(locksUI.coverComplete),
        },
        playlistOrder: Array.isArray(playlistOrder) ? [...playlistOrder] : [],
        songs: Array.isArray(playlist) ? playlist.map((t) => ({ ...t, file: { ...(t.file || {}) } })) : [],
        meta: { ...(current?.album?.meta || {}) },
        cover: { ...(current?.album?.cover || {}) },
        totalSeconds: Number(totalSeconds || 0),
      };

      const next = {
        ...current,
        album: {
          ...(current.album || {}),
          masterSave: snap,
        },
        updatedAt: new Date().toISOString(),
      };

      persistProject(next);

      const res = await masterSaveMiniSite({ projectId, project: next });
      const snapshotKey = String(res?.snapshotKey || "");
      const savedAt = new Date().toISOString();

      if (snapshotKey) {
        const updated = {
          ...next,
          master: {
            ...(next.master || {}),
            isMasterSaved: true,
            masterSavedAt: savedAt,
            lastSnapshotKey: snapshotKey,
          },
          publish: {
            ...(next.publish || {}),
            snapshotKey,
          },
          updatedAt: savedAt,
        };
        persistProject(updated);
      }


      window.alert("Album Master Save confirmed.\n\nSnapshot written to album.masterSave.");
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setMsBusy(false);
    }
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
    <div style={{ maxWidth: 1200, padding: 18 }}>
      {/* Header */}
      <div style={{ paddingBottom: 10, borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: 30, fontWeight: 950 }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Project <b>{projectId}</b>
        </div>
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 900 }}>{err}</div> : null}

      {/* Two columns */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        {/* LEFT COLUMN */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* (L1) PLAYER CARD (top) */}
          <Card
            title="Player"
            right={
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
              <span style={{ fontFamily: styles.mono, fontWeight: 900 }}>
                {nowTrack ? `#${activeIndex + 1} · ${nowTrack.title || `Song ${nowTrack.sourceSlot}`}` : "—"}
              </span>
            </div>

            <div style={{ marginTop: 10 }}>
              <audio ref={audioRef} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.85 }}>
                  {fmtTime(time)} / {fmtTime(dur)}
                </div>
                <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.7 }}>
                  {dur > 0 ? `${Math.round((time / dur) * 100)}%` : "—"}
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

          {/* (L2) TRACKS CARD (below player) */}
          <Card
            title="Tracks"
            right={<LockPill locked={playlistLocked} onToggle={() => toggleLock("playlistComplete")} disabled={lockBusy} label="Playlist" />}
          >
            <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
              {playlistLocked
                ? "LOCKED — drag & drop disabled."
                : "UNLOCKED — drag & drop enabled. Click a track to play in this order."}
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {playlist.map((t, i) => {
                const active = i === activeIndex;
                const canDrag = !playlistLocked;

                return (
                  <div
                    key={`${t.sourceSlot}-${i}`}
                    draggable={canDrag}
                    onDragStart={() => onDragStart(i)}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(i)}
                    onClick={() => playIndex(i)}
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      background: active ? "rgba(59,130,246,0.10)" : "#fff",
                      cursor: "pointer",
                      userSelect: "none",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      opacity: playlistLocked ? 0.95 : 1,
                    }}
                    title={canDrag ? "Drag to reorder (unlocked)" : "Locked"}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {i + 1}. {t.title || `Song ${t.sourceSlot}`}
                      </div>
                      <div style={{ fontFamily: styles.mono, fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                        slot={t.sourceSlot} · s3Key={t.file?.s3Key ? "yes" : "—"}
                      </div>
                    </div>

                    <div style={{ fontFamily: styles.mono, fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                      {active ? "▶" : " "}
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
            <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
              {metaLocked ? "LOCKED — album meta is read-only." : "Edit album-level fields."}
            </div>

            {metaLocked ? (
              <ReadonlyBox title="LOCKED — Album Meta">
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={styles.fieldLabel}>Album Title</div>
                    <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>{albumTitle || "—"}</div>
                  </div>
                  <div>
                    <div style={styles.fieldLabel}>Artist Name</div>
                    <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>{artistName || "—"}</div>
                  </div>
                  <div>
                    <div style={styles.fieldLabel}>Release Date</div>
                    <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>{releaseDate || "—"}</div>
                  </div>
                  <div>
                    <div style={styles.fieldLabel}>Album Total Time</div>
                    <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
                      {totalSeconds > 0 ? fmtTime(totalSeconds) : "—"}
                    </div>
                  </div>
                </div>
              </ReadonlyBox>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div>
                  <div style={styles.fieldLabel}>Album Title</div>
                  <input
                    value={albumTitle}
                    onChange={(e) => setAlbumMetaField("albumTitle", e.target.value)}
                    style={styles.input}
                    placeholder="Album title"
                  />
                </div>
                <div>
                  <div style={styles.fieldLabel}>Artist Name</div>
                  <input
                    value={artistName}
                    onChange={(e) => setAlbumMetaField("artistName", e.target.value)}
                    style={styles.input}
                    placeholder="Artist name"
                  />
                </div>
                <div>
                  <div style={styles.fieldLabel}>Release Date</div>
                  <input
                    type="date"
                    value={releaseDate}
                    onChange={(e) => setAlbumMetaField("releaseDate", e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div>
                  <div style={styles.fieldLabel}>Album Total Time</div>
                  <div style={{ fontFamily: styles.mono, fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
                    {totalSeconds > 0 ? fmtTime(totalSeconds) : "—"}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* (R2) COVER UPLOAD CARD */}
          <Card
            title="Cover"
            right={<LockPill locked={coverLocked} onToggle={() => toggleLock("coverComplete")} disabled={lockBusy} label="Cover" />}
          >
            <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.5 }}>
              {coverLocked ? "LOCKED — cover changes disabled." : "Upload a cover image (local preview) and/or paste s3Key."}
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div>
                <div style={styles.fieldLabel}>Cover s3Key</div>
                <input
                  value={coverKey}
                  disabled={coverLocked}
                  onChange={(e) => setCoverS3Key(e.target.value)}
                  style={coverLocked ? styles.inputDisabled : styles.input}
                  placeholder="Paste cover s3Key here (optional)"
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="image/*" disabled={coverLocked} onChange={(e) => uploadCoverFile(e.target.files?.[0] || null)} />
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
