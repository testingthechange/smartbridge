// src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  ensureSongTitleJson,
  clamp,
  fmtTime,
  once,
  fetchPlaybackUrl,
} from "./catalog/catalogCore.js";

/** best-effort timeout wrapper */
function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

/** expired/invalid presigned URL signals */
function isExpiredPresignError(err) {
  const s = String(err?.message || err || "").toLowerCase();
  return (
    s.includes("403") ||
    s.includes("forbidden") ||
    s.includes("expired") ||
    s.includes("signature") ||
    s.includes("accessdenied")
  );
}

/** normalize backend base */
function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

/** Build available tracks from Catalog (album files only). Default 8, extend if more exist. */
function deriveAvailableFromCatalog(project) {
  const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const available = catalogSongs
    .map((s) => {
      const sourceSlot = Number(s?.slot || 0);
      const title = String(s?.title || "").trim();
      const s3Key = String(s?.files?.album?.s3Key || "").trim(); // album-version only
      return {
        sourceSlot,
        title,
        s3Key,
      };
    })
    .filter((x) => x.sourceSlot > 0);

  // Default = first 8 slots in order; if catalog has more, include them
  const maxCount = Math.max(8, available.length);
  const bySlot = new Map(available.map((a) => [Number(a.sourceSlot), a]));

  const out = [];
  for (let i = 1; i <= maxCount; i++) {
    const a = bySlot.get(i) || { sourceSlot: i, title: `Song ${i}`, s3Key: "" };
    out.push(a);
  }

  return out;
}

/** Ensure album order exists; if missing, build from available (only those with s3Key) */
function ensureAlbumOrder(project) {
  const existing = Array.isArray(project?.album?.songs) ? project.album.songs : [];
  if (existing.length) return existing;

  const available = deriveAvailableFromCatalog(project);
  const seeded = available
    .filter((a) => a.s3Key)
    .map((a, idx) => ({
      trackNo: idx + 1,
      sourceSlot: a.sourceSlot,
      title: a.title || `Track ${idx + 1}`,
      file: { s3Key: a.s3Key },
    }));

  return seeded;
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

  // locks (persisted)
  const playlistComplete = Boolean(project?.album?.locks?.playlistComplete);
  const metaComplete = Boolean(project?.album?.locks?.metaComplete);
  const coverComplete = Boolean(project?.album?.locks?.coverComplete);

  // derived lists
  const available = useMemo(() => deriveAvailableFromCatalog(project || {}), [project]);
  const albumOrder = useMemo(() => ensureAlbumOrder(project || {}), [project]);

  // player
  const audioRef = useRef(null);
  const playSeq = useRef(0);

  const [activeIndex, setActiveIndex] = useState(-1); // index into albumOrder
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  // drag state
  const dragIndexRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    const base =
      loadProject(projectId) || {
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        catalog: { songs: [] },
        album: {},
        nftMix: {},
        songs: {},
        meta: {},
      };

    // Ensure album container
    base.album = {
      ...(base.album || {}),
      locks: {
        playlistComplete: Boolean(base.album?.locks?.playlistComplete),
        metaComplete: Boolean(base.album?.locks?.metaComplete),
        coverComplete: Boolean(base.album?.locks?.coverComplete),
      },
      meta: {
        albumTitle: String(base.album?.meta?.albumTitle || ""),
        artistName: String(base.album?.meta?.artistName || ""),
        releaseDate: String(base.album?.meta?.releaseDate || ""),
      },
      cover: {
        ...(base.album?.cover || {}),
        s3Key: String(base.album?.cover?.s3Key || ""),
        url: String(base.album?.cover?.url || ""),
        fileName: String(base.album?.cover?.fileName || ""),
      },
      songs: Array.isArray(base.album?.songs) ? base.album.songs : [],
    };

    // Seed album.songs if missing, based on catalog album-version uploads
    if (!base.album.songs.length) {
      base.album.songs = ensureAlbumOrder(base);
    }

    saveProject(projectId, base);
    setProject(base);
  }, [projectId]);

  function updateProject(fn) {
    setProject((prev) => {
      const next = fn(prev || {});
      next.updatedAt = new Date().toISOString();
      saveProject(projectId, next);
      return next;
    });
  }

  function setLock(lockKey, value) {
    updateProject((prev) => ({
      ...prev,
      album: {
        ...(prev.album || {}),
        locks: {
          ...(prev.album?.locks || {}),
          [lockKey]: Boolean(value),
        },
      },
    }));
  }

  // ---------- audio events ----------
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onLoaded = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => {
      if (!isSeeking) setCurrentTime(a.currentTime || 0);
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
    };
  }, [isSeeking]);

  async function playAlbumIndex(idx) {
    setErr("");
    const seq = ++playSeq.current;

    if (!API_BASE) {
      setErr("Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.");
      return;
    }

    const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
    const item = list[idx];
    const s3Key = String(item?.file?.s3Key || "").trim();
    if (!s3Key) return;

    setBusy("Loading…");
    try {
      const url = await withTimeout(
        fetchPlaybackUrl({ apiBase: API_BASE, s3Key }),
        2 * 60 * 1000,
        "Playback URL timed out."
      );

      if (seq !== playSeq.current) return;

      const a = audioRef.current;
      if (!a) return;

      setActiveIndex(idx);

      const setSrcAndPlay = async (u) => {
        if (a.src !== u) {
          try {
            a.pause();
          } catch {}
          a.currentTime = 0;
          setCurrentTime(0);
          setDuration(0);

          a.src = u;
          a.load();
          await Promise.race([once(a, "canplay"), once(a, "loadedmetadata")]);
          if (seq !== playSeq.current) return;
        }
        await a.play();
      };

      try {
        await setSrcAndPlay(url);
      } catch (e) {
        if (isExpiredPresignError(e)) {
          const fresh = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
          await setSrcAndPlay(fresh);
        } else {
          throw e;
        }
      }

      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Playback failed");
    }
  }

  function togglePlay(idx) {
    const a = audioRef.current;
    if (!a) return;

    if (idx === activeIndex) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
    } else {
      playAlbumIndex(idx);
    }
  }

  function prev() {
    const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
    if (!list.length) return;
    const nextIdx = activeIndex <= 0 ? 0 : activeIndex - 1;
    playAlbumIndex(nextIdx);
  }

  function next() {
    const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
    if (!list.length) return;
    const nextIdx = activeIndex < 0 ? 0 : Math.min(list.length - 1, activeIndex + 1);
    playAlbumIndex(nextIdx);
  }

  // ---------- playlist ops ----------
  function addToAlbum(sourceSlot) {
    setErr("");

    updateProject((prev) => {
      const avail = deriveAvailableFromCatalog(prev);
      const item = avail.find((a) => Number(a.sourceSlot) === Number(sourceSlot));
      if (!item || !item.s3Key) return prev;

      const current = Array.isArray(prev?.album?.songs) ? prev.album.songs : [];
      const already = current.some((t) => Number(t.sourceSlot) === Number(sourceSlot));
      if (already) return prev;

      const nextSongs = [
        ...current,
        {
          trackNo: current.length + 1,
          sourceSlot: item.sourceSlot,
          title: String(item.title || `Track ${current.length + 1}`),
          file: { s3Key: item.s3Key },
        },
      ].map((t, idx) => ({ ...t, trackNo: idx + 1 }));

      // ensure titleJson in catalog for persistence consistency
      const nextCatalogSongs = Array.isArray(prev?.catalog?.songs) ? prev.catalog.songs : [];
      const patchedCatalog = nextCatalogSongs.map((s) => {
        if (Number(s?.slot) !== Number(sourceSlot)) return s;
        const title = String(s?.title || item.title || "").trim();
        return {
          ...s,
          title,
          titleJson: ensureSongTitleJson(Number(sourceSlot), title),
        };
      });

      // also mirror order for future nftMix page (no behavior dependency yet)
      const nextNftMix = {
        ...(prev.nftMix || {}),
        albumOrder: nextSongs.map((t) => ({
          trackNo: t.trackNo,
          sourceSlot: t.sourceSlot,
          title: t.title,
          s3Key: t.file?.s3Key || "",
        })),
      };

      return {
        ...prev,
        catalog: { ...(prev.catalog || {}), songs: patchedCatalog },
        album: { ...(prev.album || {}), songs: nextSongs },
        nftMix: nextNftMix,
      };
    });
  }

  function removeFromAlbum(idx) {
    updateProject((prev) => {
      const current = Array.isArray(prev?.album?.songs) ? prev.album.songs : [];
      const nextSongs = current
        .filter((_, i) => i !== idx)
        .map((t, i) => ({ ...t, trackNo: i + 1 }));

      const nextNftMix = {
        ...(prev.nftMix || {}),
        albumOrder: nextSongs.map((t) => ({
          trackNo: t.trackNo,
          sourceSlot: t.sourceSlot,
          title: t.title,
          s3Key: t.file?.s3Key || "",
        })),
      };

      // if removing active track, pause
      const a = audioRef.current;
      if (a && idx === activeIndex) {
        try {
          a.pause();
        } catch {}
      }

      return {
        ...prev,
        album: { ...(prev.album || {}), songs: nextSongs },
        nftMix: nextNftMix,
      };
    });

    // adjust local activeIndex view
    setActiveIndex((prevIdx) => {
      if (prevIdx === idx) return -1;
      if (prevIdx > idx) return prevIdx - 1;
      return prevIdx;
    });
  }

  function move(idx, dir) {
    updateProject((prev) => {
      const current = Array.isArray(prev?.album?.songs) ? prev.album.songs : [];
      const j = idx + dir;
      if (j < 0 || j >= current.length) return prev;

      const nextSongs = current.slice();
      const tmp = nextSongs[idx];
      nextSongs[idx] = nextSongs[j];
      nextSongs[j] = tmp;

      const normalized = nextSongs.map((t, i) => ({ ...t, trackNo: i + 1 }));

      const nextNftMix = {
        ...(prev.nftMix || {}),
        albumOrder: normalized.map((t) => ({
          trackNo: t.trackNo,
          sourceSlot: t.sourceSlot,
          title: t.title,
          s3Key: t.file?.s3Key || "",
        })),
      };

      return {
        ...prev,
        album: { ...(prev.album || {}), songs: normalized },
        nftMix: nextNftMix,
      };
    });

    // keep activeIndex pointed at same item after swap
    setActiveIndex((prevIdx) => {
      if (prevIdx === idx) return idx + dir;
      if (prevIdx === idx + dir) return idx;
      return prevIdx;
    });
  }

  // ---------- drag & drop (simple) ----------
  function onDragStart(idx) {
    dragIndexRef.current = idx;
  }

  function onDrop(idx) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === undefined) return;
    if (from === idx) return;

    updateProject((prev) => {
      const current = Array.isArray(prev?.album?.songs) ? prev.album.songs : [];
      if (!current.length) return prev;

      const nextSongs = current.slice();
      const [moved] = nextSongs.splice(from, 1);
      nextSongs.splice(idx, 0, moved);

      const normalized = nextSongs.map((t, i) => ({ ...t, trackNo: i + 1 }));

      const nextNftMix = {
        ...(prev.nftMix || {}),
        albumOrder: normalized.map((t) => ({
          trackNo: t.trackNo,
          sourceSlot: t.sourceSlot,
          title: t.title,
          s3Key: t.file?.s3Key || "",
        })),
      };

      return {
        ...prev,
        album: { ...(prev.album || {}), songs: normalized },
        nftMix: nextNftMix,
      };
    });

    setActiveIndex((prevIdx) => {
      if (prevIdx < 0) return prevIdx;
      // best-effort: if active moved, keep it near same item; exact tracking not critical for v1
      return prevIdx;
    });
  }

  // ---------- meta ----------
  function updateMeta(patch) {
    updateProject((prev) => ({
      ...prev,
      album: {
        ...(prev.album || {}),
        meta: {
          ...(prev.album?.meta || {}),
          ...patch,
        },
      },
    }));
  }

  // ---------- cover upload ----------
  async function uploadCover(file) {
    if (!file) return;
    setErr("");

    if (!API_BASE) {
      setErr("Missing VITE_API_BASE. Set it on the Render Static Site and redeploy.");
      return;
    }

    setBusy("Uploading cover…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);

      const res = await withTimeout(
        fetch(`${API_BASE}/api/upload-to-s3`, {
          method: "POST",
          headers: {
            "X-Project-Id": projectId,
          },
          body: fd,
        }),
        10 * 60 * 1000,
        "Cover upload timed out."
      );

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Cover upload failed (${res.status})`);
      }

      const s3Key = String(json?.s3Key || "").trim();
      if (!s3Key) throw new Error("Cover upload did not return s3Key");

      // presign for preview (playback-url can sign any key)
      const url = await withTimeout(
        fetchPlaybackUrl({ apiBase: API_BASE, s3Key }),
        2 * 60 * 1000,
        "Cover preview URL timed out."
      );

      updateProject((prev) => ({
        ...prev,
        album: {
          ...(prev.album || {}),
          cover: {
            s3Key,
            url,
            fileName: String(file.name || ""),
          },
        },
      }));

      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Cover upload failed");
    }
  }

  // ---------- render ----------
  if (!projectId) return <div style={{ padding: 24, fontWeight: 900 }}>Missing projectId</div>;

  const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
  const meta = project?.album?.meta || {};
  const cover = project?.album?.cover || {};

  const activeItem = activeIndex >= 0 ? list[activeIndex] : null;

  return (
    <div style={{ maxWidth: 1200 }}>
      <div
        style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          background: "#fff",
          paddingTop: 6,
          paddingBottom: 10,
          borderBottom: "1px solid rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>Album</div>
            <div style={{ fontSize: 16, opacity: 0.8, marginTop: 6 }}>
              Project: <b style={{ fontFamily: "monospace" }}>{projectId}</b>
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.6, textAlign: "right" }}>
            Backend: <span style={{ fontFamily: "monospace" }}>{API_BASE || "—"}</span>
            <div style={{ marginTop: 6 }}>
              Playlist:{" "}
              <span style={{ fontWeight: 900, color: playlistComplete ? "#065f46" : "#9f1239" }}>
                {playlistComplete ? "✅" : "🔒"}
              </span>{" "}
              Meta:{" "}
              <span style={{ fontWeight: 900, color: metaComplete ? "#065f46" : "#9f1239" }}>
                {metaComplete ? "✅" : "🔒"}
              </span>{" "}
              Cover:{" "}
              <span style={{ fontWeight: 900, color: coverComplete ? "#065f46" : "#9f1239" }}>
                {coverComplete ? "✅" : "🔒"}
              </span>
            </div>
          </div>
        </div>

        {busy ? <div style={{ marginTop: 10, fontWeight: 800 }}>{busy}</div> : null}
        {err ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(244,63,94,0.25)",
              background: "rgba(244,63,94,0.08)",
              color: "#9f1239",
              fontWeight: 900,
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        {/* LEFT: Playlist */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Album Playlist</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Source: Catalog (album files only). Default 8 tracks; if Catalog has more, they appear.
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setLock("playlistComplete", !playlistComplete)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #111827",
                  background: playlistComplete ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
                title="Toggle lock (persists)"
              >
                {playlistComplete ? "✅ Playlist Saved" : "🔒 Playlist Locked"}
              </button>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Drag & drop to reorder. This order is also mirrored to NFT Mix later.
              </div>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {/* Available (catalog) */}
            <div style={{ fontWeight: 950, marginBottom: 8 }}>Available from Catalog</div>
            <div style={{ display: "grid", gap: 8 }}>
              {available.map((a) => {
                const inAlbum = list.some((t) => Number(t.sourceSlot) === Number(a.sourceSlot));
                const canAdd = Boolean(a.s3Key) && !inAlbum;

                return (
                  <div
                    key={`avail-${a.sourceSlot}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #eef2f7",
                      background: "#fff",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>
                        Slot {a.sourceSlot}: {a.title || `Song ${a.sourceSlot}`}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, fontFamily: "monospace" }}>
                        album.s3Key: {a.s3Key ? "✅" : "—"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => addToAlbum(a.sourceSlot)}
                      disabled={!canAdd}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #111827",
                        background: canAdd ? "#111827" : "#e5e7eb",
                        color: canAdd ? "#fff" : "#6b7280",
                        fontWeight: 900,
                        cursor: canAdd ? "pointer" : "not-allowed",
                        minWidth: 84,
                      }}
                    >
                      {inAlbum ? "Added" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ height: 14 }} />

            {/* Album order */}
            <div style={{ fontWeight: 950, marginBottom: 8 }}>Album Order</div>
            {!list.length ? (
              <div style={{ padding: 12, borderRadius: 10, border: "1px solid #eef2f7", opacity: 0.8 }}>
                No album tracks yet. Add tracks from the Catalog list above (album files only).
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {list.map((t, idx) => {
                  const active = idx === activeIndex;
                  return (
                    <div
                      key={`track-${t.trackNo}-${t.sourceSlot}`}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(idx)}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #eef2f7",
                        background: active ? "rgba(59,130,246,0.06)" : "#fff",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        alignItems: "center",
                      }}
                      title="Drag to reorder"
                    >
                      <div>
                        <div style={{ fontWeight: 950 }}>
                          Track {idx + 1}: {t.title || `Track ${idx + 1}`}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          sourceSlot: <span style={{ fontFamily: "monospace" }}>{t.sourceSlot}</span>{" "}
                          · s3Key:{" "}
                          <span style={{ fontFamily: "monospace" }}>{t.file?.s3Key ? "✅" : "—"}</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => togglePlay(idx)}
                          disabled={!t.file?.s3Key}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 900,
                            cursor: t.file?.s3Key ? "pointer" : "not-allowed",
                          }}
                        >
                          {active && isPlaying ? "Pause" : "Play"}
                        </button>

                        <button
                          type="button"
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 900,
                            cursor: idx === 0 ? "not-allowed" : "pointer",
                            opacity: idx === 0 ? 0.5 : 1,
                          }}
                        >
                          ↑
                        </button>

                        <button
                          type="button"
                          onClick={() => move(idx, +1)}
                          disabled={idx === list.length - 1}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 900,
                            cursor: idx === list.length - 1 ? "not-allowed" : "pointer",
                            opacity: idx === list.length - 1 ? 0.5 : 1,
                          }}
                        >
                          ↓
                        </button>

                        <button
                          type="button"
                          onClick={() => removeFromAlbum(idx)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(244,63,94,0.35)",
                            background: "rgba(244,63,94,0.08)",
                            color: "#9f1239",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Player */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Album Player</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Album play sequence (no side menu). Uses backend presigned URLs.
            </div>
          </div>

          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {activeItem
                ? `Now Playing: Track ${activeIndex + 1} · ${activeItem.title || `Track ${activeIndex + 1}`}`
                : "Now Playing: —"}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  if (activeIndex < 0 && list.length) playAlbumIndex(0);
                  else togglePlay(activeIndex);
                }}
                disabled={!list.length}
                style={{
                  padding: "10px 12px",
                  fontWeight: 900,
                  borderRadius: 10,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "#fff",
                  cursor: list.length ? "pointer" : "not-allowed",
                }}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <button
                type="button"
                onClick={prev}
                disabled={!list.length}
                style={{
                  padding: "10px 12px",
                  fontWeight: 900,
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                }}
              >
                Prev
              </button>

              <button
                type="button"
                onClick={next}
                disabled={!list.length}
                style={{
                  padding: "10px 12px",
                  fontWeight: 900,
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                }}
              >
                Next
              </button>

              <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
                {fmtTime(currentTime)} / {fmtTime(duration)}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, Math.floor(duration || 0))}
                value={Math.floor(currentTime || 0)}
                onMouseDown={() => setIsSeeking(true)}
                onTouchStart={() => setIsSeeking(true)}
                onChange={(e) => setCurrentTime(Number(e.target.value || 0))}
                onMouseUp={() => {
                  const a = audioRef.current;
                  if (a) a.currentTime = clamp(currentTime, 0, duration || 0);
                  setIsSeeking(false);
                }}
                onTouchEnd={() => {
                  const a = audioRef.current;
                  if (a) a.currentTime = clamp(currentTime, 0, duration || 0);
                  setIsSeeking(false);
                }}
                style={{ width: "100%" }}
                disabled={!list.length}
              />
            </div>

            <audio ref={audioRef} />

            {/* Meta */}
            <div style={{ height: 14 }} />
            <div style={{ borderTop: "1px solid #eef2f7", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 950 }}>Album Meta</div>

                <button
                  type="button"
                  onClick={() => setLock("metaComplete", !metaComplete)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: metaComplete ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  {metaComplete ? "✅ Meta Saved" : "🔒 Meta Locked"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8 }}>Album Title</div>
                  <input
                    value={String(meta.albumTitle || "")}
                    onChange={(e) => updateMeta({ albumTitle: e.target.value })}
                    placeholder="Album title"
                    style={{
                      width: "100%",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8 }}>Artist Name</div>
                  <input
                    value={String(meta.artistName || "")}
                    onChange={(e) => updateMeta({ artistName: e.target.value })}
                    placeholder="Artist name"
                    style={{
                      width: "100%",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8 }}>Release Date</div>
                  <input
                    type="date"
                    value={String(meta.releaseDate || "")}
                    onChange={(e) => updateMeta({ releaseDate: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Cover */}
            <div style={{ height: 14 }} />
            <div style={{ borderTop: "1px solid #eef2f7", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 950 }}>Album Cover</div>

                <button
                  type="button"
                  onClick={() => setLock("coverComplete", !coverComplete)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: coverComplete ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  {coverComplete ? "✅ Cover Saved" : "🔒 Cover Locked"}
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => document.getElementById("album-cover-upload")?.click()}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #111827",
                      background: "#111827",
                      color: "#fff",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Upload Cover
                  </button>

                  <input
                    id="album-cover-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      e.target.value = "";
                      uploadCover(f);
                    }}
                  />

                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    File:{" "}
                    <span style={{ fontFamily: "monospace", fontWeight: 800 }}>
                      {cover.fileName || "—"}
                    </span>
                  </div>
                </div>

                {cover.url ? (
                  <div
                    style={{
                      borderRadius: 12,
                      border: "1px solid #eef2f7",
                      overflow: "hidden",
                      width: 220,
                      height: 220,
                      background: "#fafafa",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <img
                      src={cover.url}
                      alt="Album cover"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={async () => {
                        // refresh preview url if presign expired
                        if (!API_BASE || !cover.s3Key) return;
                        try {
                          const fresh = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: cover.s3Key });
                          updateProject((prev) => ({
                            ...prev,
                            album: {
                              ...(prev.album || {}),
                              cover: { ...(prev.album?.cover || {}), url: fresh },
                            },
                          }));
                        } catch {}
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    No cover uploaded yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline note (no actions here yet) */}
      <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
        <div style={{ padding: 12 }}>
          <div style={{ fontWeight: 950 }}>Pipeline</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Album page writes <span style={{ fontFamily: "monospace" }}>project.album.songs</span> (album-only order),
            meta, and cover. Master Save later snapshots everything to S3 and drives the Export green check, then Publish.
          </div>
        </div>
      </div>
    </div>
  );
}
