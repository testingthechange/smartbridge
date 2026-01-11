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
const ALBUM_BUILD_STAMP = "STAMP-ALBUM-2COL-PLAYERLEFT-METARIGHT-2026-01-11-A";

/* ---------- helpers ---------- */
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
      trackNo: out.length + 1,
      sourceSlot: slot,
      title: c.title,
      file: { s3Key: c.s3Key },
    });
  }
  return out;
}

/* ---------- UI bits ---------- */
function LockPill({ label, locked, onToggle, disabled, note }) {
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
          padding: "8px 12px",
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: bg,
          color,
          fontWeight: 900,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {label}: {locked ? "LOCKED" : "UNLOCKED"}
      </button>
      {note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
    </div>
  );
}

function Card({ title, right, children }) {
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
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 950 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ReadonlyBox({ children }) {
  return (
    <div
      style={{
        marginTop: 8,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: "#f8fafc",
        padding: 10,
      }}
    >
      {children}
    </div>
  );
}

/* ---------- main ---------- */
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
  const [busy, setBusy] = useState("");

  // locks (UI mirrors persisted state)
  const [locksUI, setLocksUI] = useState({
    playlistComplete: false,
    metaComplete: false,
    coverComplete: false,
  });

  // audio
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  // cover preview
  const lastPreviewUrlRef = useRef("");

  // init
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
          locks: {
            playlistComplete: false,
            metaComplete: false,
            coverComplete: false,
          },
          meta: { note: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
        },
      };
    if (!stored) saveProject(projectId, base);
    setProject(stored || base);
  }, [projectId]);

  // sync locks from project
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
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTimeEv);
    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTimeEv);
    };
  }, []);

  const playlistLocked = locksUI.playlistComplete;
  const metaLocked = locksUI.metaComplete;
  const coverLocked = locksUI.coverComplete;

  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked)
      return Array.isArray(project?.album?.songs)
        ? project.album.songs
        : [];
    return buildAlbumPlaylistFromCatalog(project);
  }, [project, playlistLocked]);

  function rereadProject() {
    return loadProject(projectId);
  }

  function toggleLock(lockKey) {
    const current = rereadProject() || project;
    if (!current) return;
    const was = parseLock(current?.album?.locks?.[lockKey]);
    const nextVal = !was;

    let nextAlbum = {
      ...(current.album || {}),
      locks: { ...(current.album?.locks || {}), [lockKey]: nextVal },
    };

    if (lockKey === "playlistComplete" && nextVal === true) {
      nextAlbum = {
        ...nextAlbum,
        songs: buildAlbumPlaylistFromCatalog(current),
      };
    }

    const next = {
      ...current,
      album: nextAlbum,
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  async function playIndex(idx) {
    setErr("");
    const item = playlist[idx];
    const s3Key = String(item?.file?.s3Key || "").trim();
    if (!API_BASE || !s3Key) return;

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

  function setMetaNote(v) {
    if (metaLocked) return;
    const current = rereadProject() || project;
    if (!current) return;
    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        meta: { ...(current.album?.meta || {}), note: String(v || "") },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function setCoverS3Key(v) {
    if (coverLocked) return;
    const current = rereadProject() || project;
    if (!current) return;
    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        cover: {
          ...(current.album?.cover || {}),
          s3Key: String(v || "").trim(),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function setCoverLocalPreview(file) {
    if (coverLocked || !file) return;
    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(file);
    lastPreviewUrlRef.current = url;

    const current = rereadProject() || project;
    if (!current) return;
    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        cover: {
          ...(current.album?.cover || {}),
          localPreviewUrl: url,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  function clearCover() {
    if (coverLocked) return;
    const old = String(lastPreviewUrlRef.current || "");
    if (old.startsWith("blob:")) URL.revokeObjectURL(old);
    lastPreviewUrlRef.current = "";
    const current = rereadProject() || project;
    if (!current) return;
    const next = {
      ...current,
      album: {
        ...(current.album || {}),
        cover: { s3Key: "", localPreviewUrl: "" },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
  }

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const metaNote = String(project?.album?.meta?.note || "");
  const coverKey = String(project?.album?.cover?.s3Key || "");
  const coverPreview = String(project?.album?.cover?.localPreviewUrl || "");
  const msSavedAt = project?.album?.masterSave?.savedAt || "";

  return (
    <div style={{ maxWidth: 1200, padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 950 }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Project <b>{projectId}</b> · Build <code>{ALBUM_BUILD_STAMP}</code>
        </div>
      </div>

      {busy && <div style={{ fontWeight: 900 }}>{busy}</div>}
      {err && <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>}

      {/* ================= TWO COLUMNS ================= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 16,
        }}
      >
        {/* LEFT */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Player">
            <audio ref={audioRef} />
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
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
          </Card>

          <Card
            title="Tracks"
            right={
              <LockPill
                label="Playlist"
                locked={playlistLocked}
                onToggle={() => toggleLock("playlistComplete")}
                note="Unlocked = derived · Locked = snapshot"
              />
            }
          >
            {playlist.map((t, i) => (
              <div
                key={`${t.sourceSlot}-${i}`}
                onClick={() => playIndex(i)}
                style={{
                  padding: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  marginBottom: 8,
                  background:
                    i === activeIndex ? "rgba(59,130,246,0.08)" : "#fff",
                  cursor: "pointer",
                }}
              >
                Track {i + 1}: {t.title}
              </div>
            ))}
          </Card>
        </div>

        {/* RIGHT */}
        <div style={{ display: "grid", gap: 16 }}>
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
              <ReadonlyBox>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {metaNote || "—"}
                </pre>
              </ReadonlyBox>
            ) : (
              <textarea
                value={metaNote}
                onChange={(e) => setMetaNote(e.target.value)}
                placeholder="Album meta note"
                style={{
                  width: "100%",
                  minHeight: 120,
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  padding: 10,
                }}
              />
            )}
          </Card>

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
            {coverLocked ? (
              <ReadonlyBox>
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                  s3Key: {coverKey || "—"}
                </div>
              </ReadonlyBox>
            ) : (
              <>
                <input
                  value={coverKey}
                  onChange={(e) => setCoverS3Key(e.target.value)}
                  placeholder="Paste cover s3Key"
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    padding: 10,
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setCoverLocalPreview(e.target.files?.[0] || null)
                    }
                  />
                  <button
                    type="button"
                    onClick={clearCover}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}

            {coverPreview && (
              <div style={{ marginTop: 10 }}>
                <img
                  src={coverPreview}
                  alt="cover"
                  style={{
                    maxWidth: 320,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                  }}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ================= MASTER SAVE ================= */}
      <div style={{ marginTop: 18 }}>
        <Card title="Master Save">
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            {msSavedAt ? `Album Master Saved @ ${msSavedAt}` : "—"}
          </div>
        </Card>
      </div>
    </div>
  );
}
