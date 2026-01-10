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

/* --------- UI bits --------- */
function LockPill({ label, locked, onToggle, note, disabled }) {
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
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
          {locked ? "LOCKED" : "UNLOCKED"}
        </span>
      </button>

      {note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
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
  });

  // Master Save (no popups)
  const [msArmed, setMsArmed] = useState(false);
  const [msBusy, setMsBusy] = useState(false);
  const [msMsg, setMsMsg] = useState("");

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  // cover preview url management
  const lastPreviewUrlRef = useRef("");

  // init guard
  const didInitRef = useRef(false);

  // drive pill colors from local UI state
  const playlistLocked = Boolean(locksUI.playlistComplete);
  const metaLocked = Boolean(locksUI.metaComplete);
  const coverLocked = Boolean(locksUI.coverComplete);

  const playlist = useMemo(() => {
    if (!project) return [];
    if (playlistLocked) return Array.isArray(project?.album?.songs) ? project.album.songs : [];
    return buildAlbumPlaylistFromCatalog(project);
  }, [project, playlistLocked]);

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
          meta: { note: "" },
          cover: { s3Key: "", localPreviewUrl: "" },
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
        meta: { note: "", ...(base.album?.meta || {}) },
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

  // NO POPUPS.
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
        const snap = buildAlbumPlaylistFromCatalog(current);
        nextAlbum = { ...nextAlbum, songs: snap };
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

      // Snapshot playlist/meta/cover regardless of locks
      const snapshotPlaylist = playlistLocked
        ? (Array.isArray(current?.album?.songs) ? current.album.songs : [])
        : buildAlbumPlaylistFromCatalog(current);

      const snapshot = {
        buildStamp: ALBUM_BUILD_STAMP,
        savedAt: new Date().toISOString(),
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
        updatedAt: new Date().toISOString(),
      };

      saveProject(projectId, next);
      setProject(next);

      setMsMsg(`Album Master Saved @ ${snapshot.savedAt}`);
      setMsArmed(false);
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setMsBusy(false);
    }
  }

  function setMetaNote(nextNote) {
    if (metaLocked) return;
    const current = rereadProject() || project;
    if (!current) return;

    const next = {
      ...current,
      album: {
        ...(current?.album || {}),
        meta: { ...(current?.album?.meta || {}), note: String(nextNote || "") },
      },
      updatedAt: new Date().toISOString(),
    };
    saveProject(projectId, next);
    setProject(next);
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
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "crimson", fontWeight: 900 }}>{err}</div> : null}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <LockPill
          label="Playlist"
          locked={playlistLocked}
          onToggle={() => toggleLock("playlistComplete")}
          disabled={lockBusy}
          note="Unlocked = derived from Catalog. Locked = snapshot saved."
        />
        <LockPill
          label="Meta"
          locked={metaLocked}
          onToggle={() => toggleLock("metaComplete")}
          disabled={lockBusy}
          note="Locks meta edits (read-only when locked)."
        />
        <LockPill
          label="Cover"
          locked={coverLocked}
          onToggle={() => toggleLock("coverComplete")}
          disabled={lockBusy}
          note="Locks cover changes (read-only when locked)."
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 950 }}>Playlist</div>
        <div style={{ marginTop: 10 }}>
          {playlist.map((t, i) => (
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

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Meta</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>metaLocked={String(metaLocked)}</div>
        </div>

        {metaLocked ? (
          <ReadonlyBox title="LOCKED — Meta is read-only">
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
          </ReadonlyBox>
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
      </div>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Cover</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>coverLocked={String(coverLocked)}</div>
        </div>

        {coverLocked ? (
          <ReadonlyBox title="LOCKED — Cover is read-only">
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
              s3Key: {coverKey || "—"}
            </div>
          </ReadonlyBox>
        ) : (
          <>
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
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input type="file" accept="image/*" onChange={(e) => setCoverLocalPreview(e.target.files?.[0] || null)} />
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
            </div>
          </>
        )}

        {coverPreview ? (
          <div style={{ marginTop: 10 }}>
            <img
              src={coverPreview}
              alt="cover preview"
              style={{ maxWidth: 320, borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>
        ) : null}
      </div>{/* ===================== MASTER SAVE (SINGLE) ===================== */}
<div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #ddd" }}>
  <div style={{ fontSize: 20, fontWeight: 950 }}>Master Save</div>

  <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 14 }}>
    {msSavedAt ? `Album Master Saved @ ${msSavedAt}` : "—"}
  </div>

  <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
    {!msArmed ? (
      <button
        type="button"
        onClick={() => setMsArmed(true)}
        disabled={msBusy}
        style={{
          padding: "10px 14px",
          borderRadius: 14,
          border: "1px solid #ddd",
          background: "#fff",
          fontWeight: 950,
          cursor: msBusy ? "not-allowed" : "pointer",
          opacity: msBusy ? 0.6 : 1,
        }}
      >
        Master Save
      </button>
    ) : (
      <>
        <button
          type="button"
          onClick={masterSaveAlbum}
          disabled={msBusy}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #ddd",
            background: "#fff",
            fontWeight: 950,
            cursor: msBusy ? "not-allowed" : "pointer",
            opacity: msBusy ? 0.6 : 1,
          }}
        >
          Confirm Master Save
        </button>

        <button
          type="button"
          onClick={() => setMsArmed(false)}
          disabled={msBusy}
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid #ddd",
            background: "#fff",
            fontWeight: 950,
            cursor: msBusy ? "not-allowed" : "pointer",
            opacity: msBusy ? 0.6 : 1,
          }}
        >
          Cancel
        </button>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Writes album.masterSave snapshot (playlist/meta/cover/locks/buildStamp) + stores snapshotKey.
        </div>
      </>
    )}

        {/* Publish */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fff" }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Publish</div>

          <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {!pubArmed ? (
              <button
                type="button"
                onClick={() => setPubArmed(true)}
                disabled={pubBusy}
                style={{
                  padding: "10px 14px",
                  borderRadius: 14,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontWeight: 950,
                  cursor: pubBusy ? "not-allowed" : "pointer",
                  opacity: pubBusy ? 0.6 : 1,
                }}
              >
                Publish
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={publishMiniSite}
                  disabled={pubBusy}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 950,
                    cursor: pubBusy ? "not-allowed" : "pointer",
                    opacity: pubBusy ? 0.6 : 1,
                  }}
                >
                  Confirm Publish
                </button>
                <button
                  type="button"
                  onClick={() => setPubArmed(false)}
                  disabled={pubBusy}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 950,
                    cursor: pubBusy ? "not-allowed" : "pointer",
                    opacity: pubBusy ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>

          {pubMsg ? <div style={{ marginTop: 10, fontWeight: 900 }}>{pubMsg}</div> : null}

          <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>
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
        </div>
      </div>
    </div>
  </div>
);
}

