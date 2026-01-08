// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP — MUST APPEAR IN UI */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-HARD-LOCK-NORENDER-2026-01-07-G";

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
      trackNo: out.length + 1,
      sourceSlot: slot,
      title: c.title,
      file: { s3Key: c.s3Key },
    });
  }
  return out;
}

/* --------- inline pill toggle (no component dependency) --------- */
function LockPill({ label, locked, onToggle, note }) {
  // policy: green = unlocked, red = locked
  const bg = locked ? "#fee2e2" : "#f3f4f6";
  const border = locked ? "#fecaca" : "#d1d5db";
  const color = locked ? "#991b1b" : "#111827";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={onToggle}
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
          cursor: "pointer",
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

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  const locks = project?.album?.locks || {};
  const playlistLocked = Boolean(locks?.playlistComplete);
  const metaLocked = Boolean(locks?.metaComplete);
  const coverLocked = Boolean(locks?.coverComplete);

  const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];

  // INIT — NEVER OVERWRITE locks/meta/cover
  useEffect(() => {
    if (!projectId) return;

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
          meta: { note: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
        },
      };

    const existingLocks = { ...(base.album?.locks || {}) };
    const existingMeta = { ...(base.album?.meta || {}) };
    const existingCover = { ...(base.album?.cover || {}) };

    const existingSongs = Array.isArray(base.album?.songs) ? base.album.songs : [];
    const songs = existingSongs.length ? existingSongs : buildAlbumPlaylistFromCatalog(base);

    const next = {
      ...base,
      album: {
        ...(base.album || {}),
        songs,
        locks: existingLocks,
        meta: existingMeta,
        cover: existingCover,
      },
      updatedAt: new Date().toISOString(),
    };

    saveProject(projectId, next);
    setProject(loadProject(projectId) || next);
  }, [projectId]);

  // Catalog -> Album (AlbumMode) refresh when playlist is UNLOCKED
  useEffect(() => {
    if (!projectId) return;
    if (!project) return;
    if (playlistLocked) return;

    const nextSongs = buildAlbumPlaylistFromCatalog(project);

    // IMPORTANT: preserve meta/cover/locks
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        songs: nextSongs,
        locks: { ...(project.album?.locks || {}) },
        meta: { ...(project.album?.meta || {}) },
        cover: { ...(project.album?.cover || {}) },
      },
      updatedAt: new Date().toISOString(),
    };

    saveProject(projectId, next);
    setProject(loadProject(projectId) || next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, playlistLocked, project?.catalog?.songs]);

  // audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTimeEv = () => setTime(a.currentTime || 0);

    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTimeEv);
    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTimeEv);
    };
  }, []);

  function setAlbumLock(flagKey, nextVal, confirmMsg) {
    setErr("");
    setProject((prev) => {
      if (!prev) return prev;

      const was = Boolean(prev?.album?.locks?.[flagKey]);
      const turningOff = was && !nextVal;
      if (turningOff && confirmMsg) {
        const ok = window.true;
        if (!ok) return prev;
      }

      const next = {
        ...prev,
        album: {
          ...(prev.album || {}),
          locks: { ...(prev.album?.locks || {}), [flagKey]: Boolean(nextVal) },
        },
        updatedAt: new Date().toISOString(),
      };

      saveProject(projectId, next);

      // verify persist
      const reread = loadProject(projectId);
      const persisted = Boolean(reread?.album?.locks?.[flagKey]);
      if (persisted !== Boolean(nextVal)) {
        setErr(`LOCK FAILED TO PERSIST (${flagKey})`);
        return next;
      }
      return reread || next;
    });
  }

  function setMetaNote(nextNote) {
    if (metaLocked) return; // HARD GUARD (state)
    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        album: { ...(prev.album || {}), meta: { ...(prev.album?.meta || {}), note: String(nextNote || "") } },
        updatedAt: new Date().toISOString(),
      };
      saveProject(projectId, next);
      return loadProject(projectId) || next;
    });
  }

  function setCoverS3Key(nextKey) {
    if (coverLocked) return; // HARD GUARD (state)
    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        album: { ...(prev.album || {}), cover: { ...(prev.album?.cover || {}), s3Key: String(nextKey || "").trim() } },
        updatedAt: new Date().toISOString(),
      };
      saveProject(projectId, next);
      return loadProject(projectId) || next;
    });
  }

  function setCoverLocalPreview(file) {
    if (coverLocked) return; // HARD GUARD (state)
    if (!file) return;

    const url = URL.createObjectURL(file);

    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        album: {
          ...(prev.album || {}),
          cover: { ...(prev.album?.cover || {}), localPreviewUrl: url },
        },
        updatedAt: new Date().toISOString(),
      };
      saveProject(projectId, next);
      return loadProject(projectId) || next;
    });
  }

  function clearCover() {
    if (coverLocked) return; // HARD GUARD (state)
    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        album: { ...(prev.album || {}), cover: { s3Key: "", localPreviewUrl: "" } },
        updatedAt: new Date().toISOString(),
      };
      saveProject(projectId, next);
      return loadProject(projectId) || next;
    });
  }

  async function playIndex(idx) {
    setErr("");
    if (!API_BASE) {
      setErr("Missing VITE_API_BASE");
      return;
    }

    const item = list[idx];
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

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const metaNote = String(project?.album?.meta?.note || "");
  const coverKey = String(project?.album?.cover?.s3Key || "");
  const coverPreview = String(project?.album?.cover?.localPreviewUrl || "");

  return (
    <div style={{ maxWidth: 1100, padding: 18 }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid #ddd" }}>
        <div style={{ fontSize: 32, fontWeight: 900 }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Project <b>{projectId}</b> · Build <code>{ALBUM_BUILD_STAMP}</code>
        </div>

        {/* DEBUG: keep until stable */}
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }}>
        </div>
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "crimson", fontWeight: 900 }}>{err}</div> : null}

      {/* LOCKS */}
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <LockPill
          label="Playlist"
          locked={playlistLocked}
          onToggle={() =>
            setAlbumLock("playlistComplete", !playlistLocked, "Unlocking allows catalog overwrite. Continue?")
          }
          note="Locks arrangement + blocks catalog push when locked"
        />
        <LockPill
          label="Meta"
          locked={metaLocked}
          onToggle={() => setAlbumLock("metaComplete", !metaLocked, "Unlocking allows meta edits again. Continue?")}
          note="Locks meta edits (read-only when locked)"
        />
        <LockPill
          label="Cover"
          locked={coverLocked}
          onToggle={() => setAlbumLock("coverComplete", !coverLocked, "Unlocking allows cover changes again. Continue?")}
          note="Locks cover changes (read-only when locked)"
        />
      </div>

      {/* PLAYLIST (always playable) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 950 }}>Playlist</div>
        <div style={{ marginTop: 10 }}>
          {list.map((t, i) => (
            <div
              key={`${t.sourceSlot}-${i}`}
              style={{
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 10,
                marginBottom: 8,
                background: i === activeIndex ? "rgba(59,130,246,0.08)" : "#fff",
                cursor: "pointer",
              }}
              onClick={() => playIndex(i)}
            >
              Track {i + 1}: {t.title || `Song ${t.sourceSlot}`}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          <audio ref={audioRef} />
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>
            {fmtTime(time)} / {fmtTime(dur)}
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
            style={{ width: "100%" }}
          />
        </div>
      </div>

      {/* META */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Meta</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
            metaLocked={String(metaLocked)}
          </div>
        </div>

        {/* HARD LOCK: do not render an editable textarea when locked */}
        {metaLocked ? (
          <div
            style={{
              marginTop: 8,
              borderRadius: 10,
              border: "1px solid #ddd",
              padding: 10,
              background: "#f8fafc",
              opacity: 0.9,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: "#991b1b", marginBottom: 6 }}>
              LOCKED — Meta is read-only
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12,
              }}
            >
              {metaNote || "—"}
            </pre>
          </div>
        ) : (
          <textarea
            value={metaNote}
            onChange={(e) => setMetaNote(e.target.value)}
            placeholder="AlbumMode meta note"
            style={{
              width: "100%",
              marginTop: 8,
              minHeight: 90,
              borderRadius: 10,
              border: "1px solid #ddd",
              padding: 10,
            }}
          />
        )}

        <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
          metaNoteStored="{metaNote}"
        </div>
      </div>

      {/* COVER */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Cover</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
            coverLocked={String(coverLocked)}
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Stored as <code>album.cover.s3Key</code> (S3 key) and <code>album.cover.localPreviewUrl</code> (local preview).
        </div>

        {/* HARD LOCK: do not render editable s3Key input when locked */}
        {coverLocked ? (
          <div
            style={{
              marginTop: 8,
              borderRadius: 10,
              border: "1px solid #ddd",
              padding: 10,
              background: "#f8fafc",
              opacity: 0.9,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: "#991b1b", marginBottom: 6 }}>
              LOCKED — Cover is read-only
            </div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
              s3Key: {coverKey || "—"}
            </div>
          </div>
        ) : (
          <input
            value={coverKey}
            onChange={(e) => setCoverS3Key(e.target.value)}
            placeholder="Paste cover s3Key here"
            style={{
              width: "100%",
              marginTop: 8,
              borderRadius: 10,
              border: "1px solid #ddd",
              padding: 10,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          />
        )}

        {/* HARD LOCK: do not render a file input when locked */}
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {coverLocked ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#f8fafc",
                color: "#991b1b",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              LOCKED — Upload disabled
            </div>
          ) : (
            <>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverLocalPreview(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={clearCover}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Clear Cover
              </button>
            </>
          )}
        </div>

        {coverPreview ? (
          <div style={{ marginTop: 10 }}>
            <img
              src={coverPreview}
              alt="cover preview"
              style={{ maxWidth: 320, borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
