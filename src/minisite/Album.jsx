// src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  loadProject,
  saveProject,
  clamp,
  fmtTime,
  once,
  fetchPlaybackUrl,
  ensureSongTitleJson,
} from "./catalog/catalogCore.js";

function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

function normalizeBase(s) {
  return String(s || "").trim().replace(/\/+$/, "");
}

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

/**
 * Build the ALBUM playlist from Catalog (album-version only).
 * Rules:
 * - default album length = 8
 * - if catalog has more slots, extend
 * - include title from catalog slot
 * - include s3Key only from catalog.files.album.s3Key (never A/B)
 * - store as project.album.songs with trackNo + sourceSlot + file.s3Key
 */
function buildAlbumPlaylistFromCatalog(project) {
  const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
  const bySlot = new Map(
    catalogSongs.map((s) => [
      Number(s?.slot || 0),
      {
        slot: Number(s?.slot || 0),
        title: String(s?.title || "").trim(),
        s3Key: String(s?.files?.album?.s3Key || "").trim(), // ALBUM ONLY
      },
    ])
  );

  const maxSlot = Math.max(8, catalogSongs.length || 0, 8);
  const list = [];
  for (let slot = 1; slot <= maxSlot; slot++) {
    const c = bySlot.get(slot) || { slot, title: `Song ${slot}`, s3Key: "" };
    list.push({
      trackNo: list.length + 1,
      sourceSlot: slot,
      title: c.title || `Song ${slot}`,
      file: { s3Key: c.s3Key || "" },
    });
  }
  return list;
}

function normalizeTrackNos(songs) {
  return (Array.isArray(songs) ? songs : []).map((t, i) => ({ ...t, trackNo: i + 1 }));
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

  // audio / player state
  const audioRef = useRef(null);
  const playSeq = useRef(0);

  const [activeIndex, setActiveIndex] = useState(-1); // index into album list
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  // drag state
  const dragIndexRef = useRef(null);

  // init / ensure album structure
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

    // If album.songs missing, build a full-length (default 8) playlist from catalog.
    if (!base.album.songs.length) {
      base.album.songs = buildAlbumPlaylistFromCatalog(base);
    } else {
      // Keep existing order, but refresh titles/s3Keys from current catalog for each sourceSlot.
      const refreshed = refreshAlbumFromCatalog(base, base.album.songs);
      base.album.songs = normalizeTrackNos(refreshed);
    }

    // Mirror order to nftMix for later (universal logic, but no UI there yet)
    base.nftMix = {
      ...(base.nftMix || {}),
      albumOrder: base.album.songs.map((t) => ({
        trackNo: t.trackNo,
        sourceSlot: t.sourceSlot,
        title: t.title,
        s3Key: String(t?.file?.s3Key || ""),
      })),
    };

    saveProject(projectId, base);
    setProject(base);
  }, [projectId]);

  function refreshAlbumFromCatalog(proj, albumSongs) {
    const catalogSongs = Array.isArray(proj?.catalog?.songs) ? proj.catalog.songs : [];
    const bySlot = new Map(
      catalogSongs.map((s) => [
        Number(s?.slot || 0),
        {
          title: String(s?.title || "").trim(),
          s3Key: String(s?.files?.album?.s3Key || "").trim(), // ALBUM ONLY
        },
      ])
    );

    const maxSlot = Math.max(8, catalogSongs.length || 0, 8);
    const existingBySourceSlot = new Map(
      (Array.isArray(albumSongs) ? albumSongs : []).map((t) => [Number(t?.sourceSlot || 0), t])
    );

    const out = [];
    for (let slot = 1; slot <= maxSlot; slot++) {
      const cat = bySlot.get(slot) || { title: `Song ${slot}`, s3Key: "" };
      const prev = existingBySourceSlot.get(slot);
      out.push({
        trackNo: out.length + 1,
        sourceSlot: slot,
        title: String(prev?.title || cat.title || `Song ${slot}`),
        file: { s3Key: String(cat.s3Key || "") },
      });
    }
    return out;
  }

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

  function setAlbumSongs(nextSongs) {
    updateProject((prev) => {
      const normalized = normalizeTrackNos(nextSongs);
      return {
        ...prev,
        album: { ...(prev.album || {}), songs: normalized },
        nftMix: {
          ...(prev.nftMix || {}),
          albumOrder: normalized.map((t) => ({
            trackNo: t.trackNo,
            sourceSlot: t.sourceSlot,
            title: t.title,
            s3Key: String(t?.file?.s3Key || ""),
          })),
        },
      };
    });
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
      setErr("Missing VITE_API_BASE. Set it on Render Static Site and redeploy.");
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

  function toggleRowPlay(idx) {
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

  // ---------- drag & drop reorder (integrated) ----------
  function onDragStart(idx) {
    dragIndexRef.current = idx;
  }

  function onDrop(idx) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;

    if (from === null || from === undefined) return;
    if (from === idx) return;

    const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
    const nextList = list.slice();
    const [moved] = nextList.splice(from, 1);
    nextList.splice(idx, 0, moved);

    // Keep active track index roughly consistent:
    // If active item moved, update activeIndex to new position.
    const active = activeIndex;
    let nextActive = active;
    if (active === from) nextActive = idx;
    else if (from < active && idx >= active) nextActive = active - 1;
    else if (from > active && idx <= active) nextActive = active + 1;

    setActiveIndex(nextActive);
    setAlbumSongs(nextList);
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
      setErr("Missing VITE_API_BASE. Set it on Render Static Site and redeploy.");
      return;
    }

    setBusy("Uploading cover…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);

      // query projectId for guaranteed backend resolution
      const res = await withTimeout(
        fetch(`${API_BASE}/api/upload-to-s3?projectId=${encodeURIComponent(projectId)}`, {
          method: "POST",
          headers: {
            "X-Project-Id": projectId,
            "X-ProjectId": projectId,
            "X-SB-Project-Id": projectId,
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

  // ---------- small helpers ----------
  function refreshFromCatalogNow() {
    updateProject((prev) => {
      const list = Array.isArray(prev?.album?.songs) ? prev.album.songs : [];
      const refreshed = refreshAlbumFromCatalog(prev, list);
      return {
        ...prev,
        album: { ...(prev.album || {}), songs: normalizeTrackNos(refreshed) },
        nftMix: {
          ...(prev.nftMix || {}),
          albumOrder: normalizeTrackNos(refreshed).map((t) => ({
            trackNo: t.trackNo,
            sourceSlot: t.sourceSlot,
            title: t.title,
            s3Key: String(t?.file?.s3Key || ""),
          })),
        },
      };
    });
  }

  // ---------- render ----------
  if (!projectId) return <div style={{ padding: 24, fontWeight: 900 }}>Missing projectId</div>;

  const list = Array.isArray(project?.album?.songs) ? project.album.songs : [];
  const meta = project?.album?.meta || {};
  const cover = project?.album?.cover || {};

  const activeItem = activeIndex >= 0 ? list[activeIndex] : null;

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
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
        {/* LEFT: Unified Album Playlist */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Album Playlist</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              One line per song. Drag to reorder. Album-version only (Catalog → files.album.s3Key).
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
              >
                {playlistComplete ? "✅ Playlist Saved" : "🔒 Playlist Locked"}
              </button>

              <button
                type="button"
                onClick={refreshFromCatalogNow}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
                title="Refresh titles + album s3Keys from current Catalog"
              >
                Refresh from Catalog
              </button>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                This order will be mirrored to NFT Mix later.
              </div>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {!list.length ? (
              <div style={{ padding: 12, borderRadius: 10, border: "1px solid #eef2f7", opacity: 0.8 }}>
                No album playlist found.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {list.map((t, idx) => {
                  const hasAudio = Boolean(String(t?.file?.s3Key || "").trim());
                  const isActive = idx === activeIndex;
                  const rowPlaying = isActive && isPlaying;

                  return (
                    <div
                      key={`album-row-${t.sourceSlot}`}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(idx)}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: "1px solid #eef2f7",
                        background: isActive ? "rgba(59,130,246,0.06)" : "#fff",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 12,
                        alignItems: "center",
                      }}
                      title="Drag to reorder"
                    >
                      <div>
                        <div style={{ fontWeight: 950, fontSize: 18, lineHeight: 1.15 }}>
                          Track {idx + 1}: {t.title || `Song ${t.sourceSlot}`}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                          Slot {t.sourceSlot} · album audio:{" "}
                          <span style={{ fontFamily: "monospace", fontWeight: 900 }}>
                            {hasAudio ? "✅" : "—"}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => toggleRowPlay(idx)}
                          disabled={!hasAudio}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 950,
                            cursor: hasAudio ? "pointer" : "not-allowed",
                            opacity: hasAudio ? 1 : 0.5,
                            minWidth: 96,
                          }}
                        >
                          {rowPlaying ? "Pause" : "Play"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Player + Meta + Cover */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Album Player</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              No side menu. Uses backend presigned URLs.
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
                  else if (activeIndex >= 0) toggleRowPlay(activeIndex);
                }}
                disabled={!list.length}
                style={{
                  padding: "10px 12px",
                  fontWeight: 950,
                  borderRadius: 12,
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
                  fontWeight: 950,
                  borderRadius: 12,
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
                  fontWeight: 950,
                  borderRadius: 12,
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
                  <div style={{ fontSize: 12, opacity: 0.7 }}>No cover uploaded yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline note */}
      <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
        <div style={{ padding: 12 }}>
          <div style={{ fontWeight: 950 }}>Pipeline</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Album page writes <span style={{ fontFamily: "monospace" }}>project.album.songs</span> (album-only order),
            meta, and cover. Master Save later snapshots everything to S3 and drives Export green checks, then Publish.
          </div>
        </div>
      </div>
    </div>
  );
}
