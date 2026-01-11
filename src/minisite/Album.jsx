// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP — MUST APPEAR IN UI */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-LOCKED-LAYOUT-2COL-DND-PLAYER-MASTERSAVE-2026-01-10-A";

/* ---- helpers ---- */
function normalizeBase(s) {
  return String(s || "")
    .trim()
    .replace(/\/+$/, "");
}

function safeName(name) {
  return String(name || "upload").replace(/[^a-zA-Z0-9._-]+/g, "_");
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
      Number(s?.slot || 0),
      {
        title: pickCatalogTitle(s, Number(s?.slot || 0)),
        s3Key: String(s?.files?.album?.s3Key || s?.files?.master?.s3Key || "").trim(),
        sourceSlot: Number(s?.slot || s?.songNumber || 0) || 0,
      },
    ])
  );

  const maxSlot = Math.max(8, catalogSongs.length || 0);
  const out = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const c = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "", sourceSlot: slot };
    out.push({
      trackNo: out.length + 1,
      sourceSlot: c.sourceSlot || slot,
      title: c.title,
      file: { s3Key: c.s3Key },
      id: `slot-${slot}`,
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

function sumDurationsSecondsFromPlaylist(playlist) {
  // If you later store per-track duration, use it. For now, return 0 (unknown).
  // Kept as a hook so UI can show total when available.
  return 0;
}

/* --------- UI bits --------- */
function LockPill({ label, locked, onToggle, note, disabled }) {
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.2, textTransform: "uppercase" }}>{label}</div>
        {note ? <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
      </div>

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
          flex: "0 0 auto",
        }}
        title="Toggle lock"
      >
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
          {locked ? "LOCKED" : "UNLOCKED"}
        </span>
      </button>
    </div>
  );
}

function Card({ title, children, right, lock }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 14,
        background: "#fff",
        boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 950 }}>{title}</div>
        {right ? <div>{right}</div> : null}
      </div>
      {lock ? <div style={{ marginTop: 10 }}>{lock}</div> : null}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, textTransform: "uppercase" }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ""}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid #d1d5db",
          background: disabled ? "#f8fafc" : "#fff",
          fontSize: 13,
          outline: "none",
          opacity: disabled ? 0.8 : 1,
        }}
      />
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

  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // guard against rapid toggles / re-entry
  const [lockBusy, setLockBusy] = useState(false);

  // Independent per-card locks
  const [locksUI, setLocksUI] = useState({
    playlistComplete: false,
    metaComplete: false,
    coverComplete: false,
  });

  // Master Save
  const [msArmed, setMsArmed] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [msMsg, setMsMsg] = useState("");

  // Publish placeholders retained if you later wire it back in
  const [pubArmed, setPubArmed] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [pubMsg, setPubMsg] = useState("");
  const [pub, setPub] = useState(null);

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

  const playlistLocked = Boolean(locksUI.playlistComplete);
  const metaLocked = Boolean(locksUI.metaComplete);
  const coverLocked = Boolean(locksUI.coverComplete);

  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked) return Array.isArray(project?.album?.songs) ? project.album.songs : [];
    return buildAlbumPlaylistFromCatalog(project);
  }, [project, playlistLocked]);

  const albumMeta = useMemo(() => {
    const m = project?.album?.meta || {};
    return {
      title: String(m.title || ""),
      artist: String(m.artist || ""),
      releaseDate: String(m.releaseDate || ""),
    };
  }, [project]);

  const msSavedAt = String(project?.album?.masterSave?.savedAt || "");
  const coverKey = String(project?.album?.cover?.s3Key || "");
  const coverPreview = String(project?.album?.cover?.localPreviewUrl || "");

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
          locks: { playlistComplete: false, metaComplete: false, coverComplete: false },
          meta: { title: "", artist: "", releaseDate: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
          masterSave: null,
        },
      };

    const next = {
      ...base,
      album: {
        ...(base.album || {}),
        songs: Array.isArray(base.album?.songs) ? base.album.songs : [],
        locks: {
          playlistComplete: false,
          metaComplete: false,
          coverComplete: false,
          ...(base.album?.locks || {}),
        },
        meta: {
          title: "",
          artist: "",
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

  // audio events (duration/time/ended -> continuous play)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTimeEv = () => setTime(a.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      // continuous play: next
      const next = activeIndex + 1;
      if (next >= 0 && next < playlist.length) playIndex(next);
      else setIsPlaying(false);
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
  }, [activeIndex, playlist.length]);

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

  // Toggle locks: Playlist lock snapshots current derived playlist into album.songs.
  function toggleLock(lockKey) {
    if (lockBusy) return;
    setLockBusy(true);
    setErr("");

    try {
      setLocksUI((prev) => ({ ...prev, [lockKey]: !Boolean(prev?.[lockKey]) }));

      const current = rereadProject() || project;
      if (!current) return;

      const wasLocked = parseLock(current?.album?.locks?.[lockKey]);
      const nextVal = !wasLocked;

      let nextAlbum = {
        ...(current?.album || {}),
        locks: { ...(current?.album?.locks || {}), [lockKey]: nextVal },
      };

      if (lockKey === "playlistComplete" && nextVal === true) {
        const snap = buildAlbumPlaylistFromCatalog(current).map((t, i) => ({ ...t, trackNo: i + 1 }));
        nextAlbum = { ...nextAlbum, songs: snap };
      }

      const next = { ...current, album: nextAlbum, updatedAt: new Date().toISOString() };
      saveProject(projectId, next);
      setProject(next);
    } finally {
      setLockBusy(false);
    }
  }

  // Drag & drop (ONLY when playlist is UNLOCKED)
  const [dragFrom, setDragFrom] = useState(-1);
  function moveItem(arr, from, to) {
    const a = [...arr];
    const [it] = a.splice(from, 1);
    a.splice(to, 0, it);
    return a.map((t, i) => ({ ...t, trackNo: i + 1 }));
  }
  function persistPlaylistSnapshot(nextSongs) {
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        songs: nextSongs,
        // keep lock false while editing
        locks: { ...(current?.album?.locks || {}), playlistComplete: false },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }
  function ensureEditablePlaylist() {
    // when unlocked, we edit album.songs as the working arrangement; initialize from derived playlist once
    const current = rereadProject() || project;
    if (!current) return [];
    const existing = Array.isArray(current?.album?.songs) ? current.album.songs : [];
    if (existing.length) return existing.map((t, i) => ({ ...t, trackNo: i + 1 }));
    const derived = buildAlbumPlaylistFromCatalog(current).map((t, i) => ({ ...t, trackNo: i + 1 }));
    persistPlaylistSnapshot(derived);
    return derived;
  }

  async function playIndex(idx) {
    setErr("");
    if (!API_BASE) {
      setErr("Missing VITE_BACKEND_URL / VITE_API_BASE");
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

  async function playPrev() {
    if (!playlist.length) return;
    const idx = activeIndex <= 0 ? 0 : activeIndex - 1;
    await playIndex(idx);
  }

  async function playNext() {
    if (!playlist.length) return;
    const idx = activeIndex < 0 ? 0 : clamp(activeIndex + 1, 0, playlist.length - 1);
    await playIndex(idx);
  }

  async function togglePlayPause() {
    const a = audioRef.current;
    if (!a) return;
    if (activeIndex < 0 && playlist.length) {
      await playIndex(0);
      return;
    }
    if (a.paused) {
      try {
        await a.play();
      } catch {}
    } else {
      a.pause();
    }
  }

  function setMetaField(key, nextValue) {
    if (metaLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        meta: { ...(current?.album?.meta || {}), [key]: String(nextValue || "") },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function setCoverLocalPreview(file) {
    if (coverLocked) return;
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
        cover: { ...(current?.album?.cover || {}), localPreviewUrl: url },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
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

  async function uploadAlbumCoverToS3(file) {
    if (coverLocked) return;
    if (!file) return;

    if (!API_BASE) {
      setErr("Missing VITE_BACKEND_URL / VITE_API_BASE");
      return;
    }

    setBusy("Uploading cover…");
    setErr("");

    try {
      const form = new FormData();
      form.append("file", file, safeName(file.name || "cover.png"));
      // Optional: let backend decide key, but provide a predictable prefix via s3Key if desired:
      // form.append("s3Key", `storage/projects/${projectId}/album/cover/${Date.now()}__${safeName(file.name)}`);

      const r = await fetch(`${API_BASE}/api/upload-to-s3?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        body: form,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      const s3Key = String(j?.s3Key || "").trim();
      const current = rereadProject() || project;
      if (!current) return;

      const next = {
        ...current,
        album: {
          ...(current?.album || {}),
          cover: { ...(current?.album?.cover || {}), s3Key },
        },
        updatedAt: new Date().toISOString(),
      };
      saveProject(projectId, next);
      setProject(next);

      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Cover upload failed");
    }
  }

  async function masterSaveAlbum() {
    if (msBusy) return;
    setMsBusy(true);
    setMsMsg("");
    setErr("");

    try {
      const current = rereadProject() || project;
      if (!current) {
        setMsMsg("No project loaded.");
        return;
      }

      // Ensure we always snapshot the *current* intended playlist:
      // - if playlist is locked, use stored album.songs
      // - if unlocked, use the editable working album.songs (initialized from derived)
      const workingSongs = playlistLocked
        ? (Array.isArray(current?.album?.songs) ? current.album.songs : [])
        : ensureEditablePlaylist();

      const snapshot = {
        buildStamp: ALBUM_BUILD_STAMP,
        savedAt: new Date().toISOString(),
        projectId,
        locks: {
          playlistComplete: Boolean(locksUI.playlistComplete),
          metaComplete: Boolean(locksUI.metaComplete),
          coverComplete: Boolean(locksUI.coverComplete),
        },
        playlist: workingSongs.map((t, i) => ({ ...t, trackNo: i + 1 })),
        meta: { ...(current?.album?.meta || {}) },
        cover: { ...(current?.album?.cover || {}) },
      };

      const nextProject = {
        ...current,
        album: {
          ...(current?.album || {}),
          masterSave: snapshot,
          // keep current songs as-is
          songs: snapshot.playlist,
        },
        updatedAt: new Date().toISOString(),
      };

      // Persist locally first
      saveProject(projectId, nextProject);
      setProject(nextProject);

      // Also write to backend master-save snapshot (canonical)
      if (API_BASE) {
        const r = await fetch(`${API_BASE}/api/master-save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, project: nextProject }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok) {
          const snapshotKey = String(j?.snapshotKey || "");
          const next2 = {
            ...nextProject,
            album: {
              ...(nextProject.album || {}),
              masterSave: { ...(nextProject.album.masterSave || snapshot), snapshotKey },
            },
            updatedAt: new Date().toISOString(),
          };
          saveProject(projectId, next2);
          setProject(next2);
        }
      }

      setMsMsg(`Album Master Saved @ ${snapshot.savedAt}`);
      setMsArmed(false);
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setMsBusy(false);
    }
  }

  // placeholder – keep it here so page doesn’t break if UI shows publish section
  async function publishMiniSite() {
    setPubBusy(true);
    setPubMsg("");
    setErr("");

    try {
      if (!API_BASE) throw new Error("Missing VITE_BACKEND_URL / VITE_API_BASE");
      const current = rereadProject() || project;
      if (!current) throw new Error("No project loaded.");

      const snapshotKey = String(current?.album?.masterSave?.snapshotKey || "").trim();
      if (!snapshotKey) throw new Error("No snapshotKey on album.masterSave. Run Master Save first.");

      const r = await fetch(`${API_BASE}/api/publish-minisite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, snapshotKey }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setPub(j);
      setPubMsg(`Published @ ${j?.publishedAt || ""}`);
      setPubArmed(false);
    } catch (e) {
      setErr(e?.message || "Publish failed");
    } finally {
      setPubBusy(false);
    }
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const editableSongs = !playlistLocked ? ensureEditablePlaylist() : [];
  const dndSongs = playlistLocked ? playlist : editableSongs;

  const totalSeconds = sumDurationsSecondsFromPlaylist(dndSongs);
  const totalTimeLabel = totalSeconds > 0 ? fmtTime(totalSeconds) : "—";

  const currentTrack = activeIndex >= 0 ? playlist[activeIndex] : null;

  return (
    <div style={{ maxWidth: 1200, padding: 18 }}>
      {/* header stamp */}
      <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 10 }}>
        Project ID: <code>{projectId}</code> {" · "} Album Build: <code>{ALBUM_BUILD_STAMP}</code>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 14, alignItems: "start" }}>
        {/* LEFT COLUMN — playlist + player */}
        <div style={{ display: "grid", gap: 14 }}>
          <Card
            title="Playlist"
            lock={
              <LockPill
                label="Playlist Lock"
                locked={playlistLocked}
                onToggle={() => toggleLock("playlistComplete")}
                disabled={lockBusy}
                note="UNLOCKED: drag to arrange (edits allowed). LOCKED: snapshot is frozen."
              />
            }
            right={
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.75 }}>
                tracks={dndSongs.length}
              </div>
            }
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
              {playlistLocked ? "Playlist is locked. Drag & drop disabled." : "Drag & drop enabled (unlocked)."}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {dndSongs.map((t, i) => {
                const isActive = i === activeIndex;
                const canDrag = !playlistLocked;
                return (
                  <div
                    key={`${t.id || t.sourceSlot}-${i}`}
                    draggable={canDrag}
                    onDragStart={() => {
                      if (!canDrag) return;
                      setDragFrom(i);
                    }}
                    onDragOver={(e) => {
                      if (!canDrag) return;
                      e.preventDefault();
                    }}
                    onDrop={() => {
                      if (!canDrag) return;
                      if (dragFrom < 0 || dragFrom === i) return;
                      const nextSongs = moveItem(dndSongs, dragFrom, i);
                      persistPlaylistSnapshot(nextSongs);
                      setDragFrom(-1);
                    }}
                    onClick={() => playIndex(i)}
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      background: isActive ? "rgba(59,130,246,0.08)" : "#fff",
                      cursor: "pointer",
                      userSelect: "none",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                    title={t?.file?.s3Key ? "Click to play" : "No audio key"}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {i + 1}. {t.title || `Song ${t.sourceSlot}`}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, opacity: 0.65 }}>
                        slot {t.sourceSlot}
                        {playlistLocked ? " · locked" : " · draggable"}
                      </div>
                    </div>

                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.7 }}>
                      {isActive ? "▶" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            title="Player"
            right={
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.75 }}>
                {currentTrack ? `#${activeIndex + 1}` : "—"}
              </div>
            }
          >
            {busy ? <div style={{ fontWeight: 900, marginBottom: 8 }}>{busy}</div> : null}
            {err ? <div style={{ color: "#b91c1c", fontWeight: 900, marginBottom: 8 }}>{err}</div> : null}

            <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 10 }}>
              {currentTrack ? currentTrack.title : "Select a track to play"}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={playPrev}
                style={btn()}
                disabled={!playlist.length}
                title="Previous"
              >
                Prev
              </button>

              <button
                type="button"
                onClick={togglePlayPause}
                style={primaryBtn()}
                disabled={!playlist.length}
                title="Play/Pause"
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <button
                type="button"
                onClick={playNext}
                style={btn()}
                disabled={!playlist.length}
                title="Next"
              >
                Next
              </button>

              <div style={{ marginLeft: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
                {fmtTime(time)} / {fmtTime(dur)}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <audio ref={audioRef} />
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
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                Click a track in the playlist to play in arrangement order. Auto-advances on track end.
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN — meta + cover + master save (+ publish placeholder) */}
        <div style={{ display: "grid", gap: 14 }}>
          <Card
            title="Album Meta"
            lock={
              <LockPill
                label="Meta Lock"
                locked={metaLocked}
                onToggle={() => toggleLock("metaComplete")}
                disabled={lockBusy}
                note="Locks album meta fields."
              />
            }
            right={
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.75 }}>
                total={totalTimeLabel}
              </div>
            }
          >
            <div style={{ display: "grid", gap: 12 }}>
              <Field
                label="Album Title"
                value={albumMeta.title}
                onChange={(v) => setMetaField("title", v)}
                disabled={metaLocked}
                placeholder="Album title"
              />
              <Field
                label="Artist Name"
                value={albumMeta.artist}
                onChange={(v) => setMetaField("artist", v)}
                disabled={metaLocked}
                placeholder="Artist / performer name"
              />
              <Field
                label="Release Date"
                value={albumMeta.releaseDate}
                onChange={(v) => setMetaField("releaseDate", v)}
                disabled={metaLocked}
                placeholder="YYYY-MM-DD"
              />
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Album Total Time: <strong>{totalTimeLabel}</strong>
              </div>
            </div>
          </Card>

          <Card
            title="Album Cover"
            lock={
              <LockPill
                label="Cover Lock"
                locked={coverLocked}
                onToggle={() => toggleLock("coverComplete")}
                disabled={lockBusy}
                note="Locks cover upload + key."
              />
            }
            right={
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.75 }}>
                {coverKey ? "s3Key ✓" : "s3Key —"}
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Upload sets <code>album.cover.s3Key</code> via backend <code>/api/upload-to-s3</code>.
              </div>

              <input
                type="file"
                accept="image/*"
                disabled={coverLocked}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (!f) return;
                  setCoverLocalPreview(f);
                  uploadAlbumCoverToS3(f);
                }}
              />

              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
                s3Key: {coverKey || "—"}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={clearCover} disabled={coverLocked} style={btn()}>
                  Clear
                </button>
              </div>

              {coverPreview ? (
                <div>
                  <img
                    src={coverPreview}
                    alt="cover preview"
                    style={{ width: "100%", maxWidth: 420, borderRadius: 14, border: "1px solid #e5e7eb" }}
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            title="Master Save"
            right={
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.75 }}>
                {msSavedAt ? "saved ✓" : "—"}
              </div>
            }
          >
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
              {msSavedAt ? `Album Master Saved @ ${msSavedAt}` : "—"}
            </div>

            {msMsg ? <div style={{ marginTop: 10, fontWeight: 900 }}>{msMsg}</div> : null}

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {!msArmed ? (
                <button type="button" onClick={() => setMsArmed(true)} disabled={msBusy} style={primaryBtn()}>
                  Master Save
                </button>
              ) : (
                <>
                  <button type="button" onClick={masterSaveAlbum} disabled={msBusy} style={primaryBtn()}>
                    Confirm Master Save
                  </button>
                  <button type="button" onClick={() => setMsArmed(false)} disabled={msBusy} style={btn()}>
                    Cancel
                  </button>
                </>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
              Writes <code>album.masterSave</code> (playlist/meta/cover/locks/buildStamp) and posts the full project to{" "}
              <code>/api/master-save</code> (stores snapshotKey when available).
            </div>
          </Card>

          {/* Optional: keep publish here if you use it later */}
          <Card title="Publish" right={null}>
            <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
              Requires album Master Save to have a <code>snapshotKey</code>.
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {!pubArmed ? (
                <button type="button" onClick={() => setPubArmed(true)} disabled={pubBusy} style={btn()}>
                  Publish
                </button>
              ) : (
                <>
                  <button type="button" onClick={publishMiniSite} disabled={pubBusy} style={btn()}>
                    Confirm Publish
                  </button>
                  <button type="button" onClick={() => setPubArmed(false)} disabled={pubBusy} style={btn()}>
                    Cancel
                  </button>
                </>
              )}
            </div>

            {pubMsg ? <div style={{ marginTop: 10, fontWeight: 900 }}>{pubMsg}</div> : null}

            <div style={{ marginTop: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
              {pub?.publishedAt ? (
                <>
                  Published At: {pub.publishedAt}
                  <br />
                  Share ID: {pub.shareId || "—"}
                  <br />
                  Manifest Key: {pub.manifestKey || "—"}
                  <br />
                  Public URL: {pub.publicUrl || "—"}
                  <br />
                  Snapshot Key: {pub.snapshotKey || "—"}
                </>
              ) : (
                "—"
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */
function btn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}
function primaryBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}
