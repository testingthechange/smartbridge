// FILE: src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { loadProject, saveProject, fmtTime, once, fetchPlaybackUrl } from "./catalog/catalogCore.js";

/* BUILD STAMP */
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-2COL-CARDS-LOCKS-2026-01-11-A";

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

function parseLock(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/* ---------------- UI bits ---------------- */

function Card({ title, right, children }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 18, fontWeight: 950 }}>{title}</div>
        {right}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function LockPill({ label, locked, onToggle, disabled }) {
  const bg = locked ? "#fee2e2" : "#dcfce7";
  const border = locked ? "#fecaca" : "#bbf7d0";
  const color = locked ? "#991b1b" : "#166534";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontWeight: 900,
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}: {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}

/* ---------------- Album ---------------- */

export default function Album() {
  const params = useParams();
  const location = useLocation();

  const projectId = useMemo(() => {
    const fromParams = (params?.projectId || "").trim();
    if (fromParams) return fromParams;
    const sp = new URLSearchParams(location.search || "");
    return (sp.get("projectId") || "").trim();
  }, [params, location.search]);

  const API_BASE = useMemo(() => normalizeBase(import.meta.env.VITE_BACKEND_URL), []);

  const [project, setProject] = useState(() => (projectId ? loadProject(projectId) : null));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  /* -------- init -------- */

  useEffect(() => {
    if (!projectId) return;
    const stored = loadProject(projectId);
    if (stored) {
      setProject(stored);
      return;
    }

    const fresh = {
      projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      catalog: { songs: [] },
      album: {
        songs: [],
        locks: {
          playlistComplete: false,
          metaComplete: false,
          coverComplete: false,
        },
        meta: { note: "" },
        cover: { s3Key: "" },
      },
    };

    saveProject(projectId, fresh);
    setProject(fresh);
  }, [projectId]);

  /* -------- derived locks -------- */

  const locks = project?.album?.locks || {};
  const playlistLocked = parseLock(locks.playlistComplete);
  const metaLocked = parseLock(locks.metaComplete);
  const coverLocked = parseLock(locks.coverComplete);

  /* -------- playlist -------- */

  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked) return Array.isArray(project.album?.songs) ? project.album.songs : [];
    return buildAlbumPlaylistFromCatalog(project);
  }, [project, playlistLocked]);

  /* -------- audio -------- */

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => setTime(a.currentTime || 0);

    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTime);
    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTime);
    };
  }, []);

  async function playIndex(idx) {
    if (!API_BASE) return;
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
      await a.play();

      setActiveIndex(idx);
      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Playback failed");
    }
  }

  /* -------- locks -------- */

  function toggleLock(key) {
    const next = {
      ...project,
      album: {
        ...project.album,
        locks: {
          ...project.album.locks,
          [key]: !parseLock(project.album.locks?.[key]),
        },
      },
      updatedAt: new Date().toISOString(),
    };

    if (key === "playlistComplete" && !playlistLocked) {
      next.album.songs = buildAlbumPlaylistFromCatalog(project);
    }

    saveProject(projectId, next);
    setProject(next);
  }

  /* -------- master save -------- */

  const msSavedAt = project?.album?.masterSave?.savedAt || "";

  async function masterSaveAlbum() {
    const snapshot = {
      buildStamp: ALBUM_BUILD_STAMP,
      savedAt: new Date().toISOString(),
      playlist,
      meta: project.album.meta,
      cover: project.album.cover,
      locks: project.album.locks,
    };

    const next = {
      ...project,
      album: {
        ...project.album,
        masterSave: snapshot,
      },
      updatedAt: new Date().toISOString(),
    };

    saveProject(projectId, next);
    setProject(next);
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  /* ---------------- render ---------------- */

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Project <b>{projectId}</b> · Build <code>{ALBUM_BUILD_STAMP}</code>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16 }}>
        {/* LEFT: TRACKS */}
        <Card
          title="Tracks"
          right={
            <LockPill
              label="Playlist"
              locked={playlistLocked}
              onToggle={() => toggleLock("playlistComplete")}
            />
          }
        >
          {playlist.map((t, i) => (
            <div
              key={`${t.sourceSlot}-${i}`}
              onClick={() => playIndex(i)}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                marginBottom: 8,
                cursor: "pointer",
                background: i === activeIndex ? "#eff6ff" : "#fff",
              }}
            >
              {i + 1}. {t.title}
            </div>
          ))}
        </Card>

        {/* RIGHT COLUMN */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* PLAYER */}
          <Card title="Player">
            <audio ref={audioRef} />
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
            {busy && <div style={{ fontWeight: 900 }}>{busy}</div>}
            {err && <div style={{ color: "crimson" }}>{err}</div>}
          </Card>

          {/* META */}
          <Card
            title="Album Meta"
            right={
              <LockPill
                label="Meta"
                locked={metaLocked}
                onToggle={() => toggleLock("metaComplete")}
              />
            }
          >
            {metaLocked ? (
              <pre style={{ fontSize: 12 }}>{project.album.meta.note || "—"}</pre>
            ) : (
              <textarea
                value={project.album.meta.note || ""}
                onChange={(e) => {
                  const next = {
                    ...project,
                    album: {
                      ...project.album,
                      meta: { note: e.target.value },
                    },
                  };
                  saveProject(projectId, next);
                  setProject(next);
                }}
                style={{ width: "100%", minHeight: 80 }}
              />
            )}
          </Card>

          {/* COVER */}
          <Card
            title="Album Cover"
            right={
              <LockPill
                label="Cover"
                locked={coverLocked}
                onToggle={() => toggleLock("coverComplete")}
              />
            }
          >
            <div style={{ fontSize: 12 }}>s3Key:</div>
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              {project.album.cover.s3Key || "—"}
            </div>
          </Card>

          {/* MASTER SAVE */}
          <Card title="Master Save">
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              {msSavedAt ? `Album Master Saved @ ${msSavedAt}` : "—"}
            </div>
            <button
              type="button"
              onClick={masterSaveAlbum}
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 10,
                fontWeight: 900,
              }}
            >
              Master Save
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}
