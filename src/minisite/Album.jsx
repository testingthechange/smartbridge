// src/minisite/Album.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import {
  ALBUM_PAGE_DEFAULT_COVER_SIZE as DEFAULT_COVER_SIZE,
  ALBUM_PAGE_SONG_COUNT as SONG_COUNT,
  ALBUM_PAGE_SLIDESHOW_MAX as SLIDESHOW_MAX,
} from "./album/meta";

import {
  readText,
  writeText,
  readBool,
  writeBool,
  readJSON,
  writeJSON,
} from "./album/albumStorage";

import { idbSetBlob, idbGetBlob, idbDelete } from "./album/albumIdb";

import {
  Field,
  card,
  subCard,
  playerCard,
  sectionTitle,
  input,
  inputReadOnly,
  primaryBtn,
  primaryBtnSmall,
  ghostBtn,
  ghostBtnSm,
  uploadBtn,
  lockBtn,
  rowPlayBtn,
  dangerBtn,
  pillRed,
} from "./album/albumStyles.jsx";

import {
  fetchPlaybackUrl,
  fmtTime,
  fmtBytes,
  shorten,
  uid,
  safeRevoke,
} from "./album/meta/albumMeta.utils";

/* ---------------- helpers ---------------- */

function sanitizeFileName(name) {
  const s = String(name || "file").trim();
  return s
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 140);
}

async function uploadToS3(API_BASE, file, s3Key) {
  const form = new FormData();
  form.append("file", file);
  form.append("s3Key", s3Key);

  const r = await fetch(`${API_BASE}/api/upload-to-s3`, {
    method: "POST",
    body: form,
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  if (!j?.ok) throw new Error(j?.error || "Upload failed");
  return { ok: true, s3Key: j.s3Key || s3Key, publicUrl: j.publicUrl || "" };
}

export default function Album() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  // ✅ FIX: API_BASE fallback (matches Catalog approach)
  const API_BASE =
    String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "") ||
    "https://album-backend-c7ed.onrender.com";

  const storageKey = (k) => `sb:${projectId || "no-project"}:album:${k}`;

  /* ---------------- Locks (persist UI state only) ---------------- */

  const [albumInfoLocked, setAlbumInfoLocked] = useState(() =>
    readBool(storageKey("albumInfoLocked"), false)
  );
  const [albumMetaLocked, setAlbumMetaLocked] = useState(() =>
    readBool(storageKey("albumMetaLocked"), false)
  );
  const [playlistLocked, setPlaylistLocked] = useState(() =>
    readBool(storageKey("playlistLocked"), false)
  );

  useEffect(
    () => writeBool(storageKey("albumInfoLocked"), albumInfoLocked),
    [albumInfoLocked, projectId] // eslint-disable-line
  );
  useEffect(
    () => writeBool(storageKey("albumMetaLocked"), albumMetaLocked),
    [albumMetaLocked, projectId] // eslint-disable-line
  );
  useEffect(
    () => writeBool(storageKey("playlistLocked"), playlistLocked),
    [playlistLocked, projectId] // eslint-disable-line
  );

  /* ---------------- Persisted Album fields ---------------- */

  const [albumName, setAlbumName] = useState(() =>
    readText(storageKey("albumName"), "")
  );
  const [artistName, setArtistName] = useState(() =>
    readText(storageKey("artistName"), "")
  );
  const [releaseDate, setReleaseDate] = useState(() =>
    readText(storageKey("releaseDate"), "")
  );

  const [bpm, setBpm] = useState(() => readText(storageKey("bpm"), ""));
  const [genre, setGenre] = useState(() => readText(storageKey("genre"), ""));

  useEffect(() => writeText(storageKey("albumName"), albumName), [albumName, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("artistName"), artistName), [artistName, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("releaseDate"), releaseDate), [releaseDate, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("bpm"), bpm), [bpm, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("genre"), genre), [genre, projectId]); // eslint-disable-line

  /* ---------------- Album Cover (LOCAL preview + S3 storage key) ---------------- */

  // Local preview key (IndexedDB)
  const coverKey = useMemo(
    () => `albumCover:${String(projectId || "no-project")}`,
    [projectId]
  );

  const [coverFileName, setCoverFileName] = useState(() =>
    readText(storageKey("coverFileName"), "")
  );
  const [coverStoreKey, setCoverStoreKey] = useState(() =>
    readText(storageKey("coverStoreKey"), "")
  );
  const [coverMime, setCoverMime] = useState(() =>
    readText(storageKey("coverMime"), "")
  );
  const [coverBytes, setCoverBytes] = useState(
    () => Number(readText(storageKey("coverBytes"), "0")) || 0
  );

  // Portable S3 key (this must be what Shop/Product uses)
  const [coverS3Key, setCoverS3Key] = useState(() =>
    readText(storageKey("coverS3Key"), "")
  );

  useEffect(() => writeText(storageKey("coverFileName"), coverFileName), [coverFileName, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverStoreKey"), coverStoreKey), [coverStoreKey, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverMime"), coverMime), [coverMime, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverBytes"), String(coverBytes || 0)), [coverBytes, projectId]); // eslint-disable-line
  useEffect(() => writeText(storageKey("coverS3Key"), coverS3Key), [coverS3Key, projectId]); // eslint-disable-line

  const coverUrlRef = useRef("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");

  const revokeCoverUrl = () => {
    safeRevoke(coverUrlRef.current);
    coverUrlRef.current = "";
  };

  const hydrateCoverPreview = useCallback(async () => {
    revokeCoverUrl();
    setCoverPreviewUrl("");

    const key = coverStoreKey || coverKey;
    if (!key) return;

    const blob = await idbGetBlob(key);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    coverUrlRef.current = url;
    setCoverPreviewUrl(url);
  }, [coverKey, coverStoreKey]);

  useEffect(() => {
    hydrateCoverPreview();
    return () => revokeCoverUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, coverStoreKey]);

  const pickCover = async (file) => {
    if (!file) return;
    if (albumInfoLocked) return;
    if (!projectId) return;

    try {
      // 1) local preview (IndexedDB)
      await idbSetBlob(coverKey, file);

      setCoverFileName(String(file.name || ""));
      setCoverStoreKey(coverKey);
      setCoverMime(String(file.type || ""));
      setCoverBytes(Number(file.size || 0));

      // instant preview
      revokeCoverUrl();
      const url = URL.createObjectURL(file);
      coverUrlRef.current = url;
      setCoverPreviewUrl(url);

      // 2) upload to S3 (portable)
      if (!API_BASE) return;

      const safeName = sanitizeFileName(file.name || "cover.jpg");
      const ts = Date.now();

      // Put it in a project-owned stable folder
      const s3Key = `storage/projects/${projectId}/album/cover/${ts}_${safeName}`;

      await uploadToS3(API_BASE, file, s3Key);
      setCoverS3Key(s3Key);
    } catch (e) {
      window.alert(`Cover save failed:\n\n${e?.message || String(e)}`);
    }
  };

  /* ---------------- Slideshow (LOCAL preview + S3 storage keys) ---------------- */

  // Stored in localStorage as metadata only. Actual files in IndexedDB.
  // shape: [{ id, fileName, mime, bytes, storeKey, s3Key }]
  const [slideshowItems, setSlideshowItems] = useState(() => {
    const saved = readJSON(storageKey("slideshowItems"), null);
    if (!Array.isArray(saved)) return [];
    return saved
      .map((x) => ({
        id: String(x?.id || ""),
        fileName: String(x?.fileName || ""),
        mime: String(x?.mime || ""),
        bytes: Number(x?.bytes || 0) || 0,
        storeKey: String(x?.storeKey || ""),
        s3Key: String(x?.s3Key || ""),
      }))
      .filter((x) => x.id && x.storeKey);
  });

  useEffect(() => writeJSON(storageKey("slideshowItems"), slideshowItems), [slideshowItems, projectId]); // eslint-disable-line

  const addSlideshowFiles = async (files) => {
    if (albumInfoLocked) return;
    if (!projectId) return;

    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    const remaining = Math.max(0, SLIDESHOW_MAX - slideshowItems.length);
    if (remaining <= 0) return;

    const toAdd = list.slice(0, remaining);

    try {
      const newRows = [];
      for (const f of toAdd) {
        const id = uid();
        const storeKey = `albumSlide:${String(projectId || "no-project")}:${id}`;

        // local preview
        await idbSetBlob(storeKey, f);

        const row = {
          id,
          fileName: String(f.name || ""),
          mime: String(f.type || ""),
          bytes: Number(f.size || 0) || 0,
          storeKey,
          s3Key: "",
        };

        // best-effort upload to S3 (portable)
        if (API_BASE) {
          try {
            const safeName = sanitizeFileName(f.name || "slide");
            const s3Key = `storage/projects/${projectId}/album/slideshow/${id}_${safeName}`;
            await uploadToS3(API_BASE, f, s3Key);
            row.s3Key = s3Key;
          } catch (e) {
            console.warn("slideshow upload failed:", e);
          }
        }

        newRows.push(row);
      }

      setSlideshowItems((prev) => [...(prev || []), ...newRows]);
    } catch (e) {
      window.alert(`Slideshow save failed:\n\n${e?.message || String(e)}`);
    }
  };

  const removeSlideshowItem = async (id) => {
    setSlideshowItems((prev) => (prev || []).filter((x) => x.id !== id));
    // Optional cleanup: delete from IDB
    try {
      const row = slideshowItems.find((x) => x.id === id);
      if (row?.storeKey) await idbDelete(row.storeKey);
    } catch {}
  };

  /* ---------------- Load latest snapshot (playback + album titles/order) ---------------- */

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [snapshot, setSnapshot] = useState(null);

  // { id, slot, title, fileName, s3Key, url }
  const [albumSongs, setAlbumSongs] = useState([]);
  const urlCacheRef = useRef({}); // s3Key -> url

  const [albumPlaylistIds, setAlbumPlaylistIds] = useState(
    () => readJSON(storageKey("albumPlaylistIds"), null) || []
  );
  useEffect(() => writeJSON(storageKey("albumPlaylistIds"), albumPlaylistIds), [albumPlaylistIds, projectId]); // eslint-disable-line

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadErr("");

      try {
        const r = await fetch(`${API_BASE}/api/master-save/latest/${projectId}`);
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (cancelled) return;

        setSnapshot(j.snapshot || null);

        const project = j?.snapshot?.project || {};
        const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
        const albumSongTitles = Array.isArray(project?.album?.songTitles) ? project.album.songTitles : [];

        // backend playlistOrder wins if present
        const backendOrder = Array.isArray(project?.album?.playlistOrder) ? project.album.playlistOrder : null;

        const baseRows = Array.from({ length: SONG_COUNT }).map((_, idx) => {
          const slot = idx + 1;

          const t = albumSongTitles.find((x) => Number(x.slot) === slot);
          const c =
            catalogSongs.find((x) => Number(x.songNumber) === slot) ||
            catalogSongs.find((x) => Number(x.slot) === slot);

          const title = String(t?.title || c?.title || "").trim() || "Album Track";

          // Album page playback uses Catalog.files.album (NOT A/B)
          const albumFile = c?.files?.album || null;

          // backwards compat:
          const legacyA = c?.versions?.A || null;

          const fileName = String(albumFile?.fileName || legacyA?.fileName || "").trim();
          const s3Key = String(albumFile?.s3Key || legacyA?.s3Key || "").trim();

          // If backend already gave a presigned playbackUrl, use it immediately (fast)
          const urlSeed = String(albumFile?.playbackUrl || "").trim();

          return { id: `slot-${slot}`, slot, title, fileName, s3Key, url: urlSeed };
        });

        const withUrls = await Promise.all(
          baseRows.map(async (row) => {
            if (row.url) return row;
            if (!row.s3Key) return row;

            const cached = urlCacheRef.current[row.s3Key];
            if (cached) return { ...row, url: cached };

            const url = await fetchPlaybackUrl(API_BASE, row.s3Key);
            if (url) urlCacheRef.current[row.s3Key] = url;
            return { ...row, url: url || "" };
          })
        );

        if (cancelled) return;

        setAlbumSongs(withUrls);

        setAlbumPlaylistIds((prev) => {
          const parsedBackend =
            Array.isArray(backendOrder) && backendOrder.length
              ? backendOrder.filter((id) => /^slot-\d+$/.test(String(id)))
              : null;

          if (parsedBackend?.length) return parsedBackend;
          if (Array.isArray(prev) && prev.length) return prev;
          return withUrls.map((s) => s.id);
        });
      } catch (e) {
        if (!cancelled) setLoadErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [API_BASE, projectId]);

  const byId = useMemo(() => {
    const m = {};
    for (const s of albumSongs) m[s.id] = s;
    return m;
  }, [albumSongs]);

  useEffect(() => {
    setAlbumPlaylistIds((prev) => prev.filter((id) => !!byId[id]));
  }, [byId]);

  const playlistSongs = useMemo(
    () => albumPlaylistIds.map((id) => byId[id]).filter(Boolean),
    [albumPlaylistIds, byId]
  );

  /* ---------------- Duration sum ---------------- */

  const [durById, setDurById] = useState({});
  const totalAlbumSeconds = useMemo(
    () => albumPlaylistIds.reduce((sum, id) => sum + (Number(durById[id]) || 0), 0),
    [albumPlaylistIds, durById]
  );

  const onDuration = useCallback((id, seconds) => {
    setDurById((prev) => ({ ...prev, [id]: Number(seconds) || 0 }));
  }, []);

  /* ---------------- Drag & drop reorder ---------------- */

  const [dragId, setDragId] = useState(null);

  const onDragStart = (id) => setDragId(id);
  const onDrop = (targetId) => {
    if (playlistLocked) return;
    if (!dragId || dragId === targetId) return;

    setAlbumPlaylistIds((prev) => {
      const fromIdx = prev.indexOf(dragId);
      const toIdx = prev.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragId);
      return next;
    });

    setDragId(null);
  };

  /* ---------------- Main player ---------------- */

  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const autoPlayRef = useRef(false);

  const [nowIdx, setNowIdx] = useState(0);
  const nowIdxRef = useRef(0);
  useEffect(() => {
    nowIdxRef.current = nowIdx;
  }, [nowIdx]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  const nowSong = playlistSongs[nowIdx] || null;
  const nowUrl = nowSong?.url || "";

  const tick = () => {
    const el = audioRef.current;
    if (!el) return;
    setT(el.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  const onLoaded = async () => {
    const el = audioRef.current;
    if (!el) return;

    setDur(el.duration || 0);

    if (autoPlayRef.current) {
      autoPlayRef.current = false;
      try {
        await el.play();
        setIsPlaying(true);
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const onEnded = () => {
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);

    const len = playlistSongs.length;
    if (!len) return;

    const cur = nowIdxRef.current;
    const nextIdx = cur + 1 < len ? cur + 1 : 0; // loop
    goTo(nextIdx, { autoplay: true });
  };

  const playPause = async () => {
    const el = audioRef.current;
    if (!el || !nowUrl) return;

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setIsPlaying(false);
    }
  };

  const hardStop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setT(0);
    setDur(el.duration || 0);
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const goTo = (nextIndex, { autoplay } = { autoplay: false }) => {
    const max = Math.max(0, playlistSongs.length - 1);
    const clamped = Math.max(0, Math.min(max, nextIndex));
    if (clamped === nowIdx) return;

    autoPlayRef.current = !!autoplay;
    setNowIdx(clamped);
    setT(0);
    setDur(0);
  };

  const prev = () => goTo(nowIdx - 1, { autoplay: true });
  const next = () => goTo(nowIdx + 1, { autoplay: true });

  const scrub = (e) => {
    const el = audioRef.current;
    if (!el || !dur) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;

    el.currentTime = dur * pct;
    setT(el.currentTime);
  };

  useEffect(() => {
    if (!nowUrl) hardStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowUrl]);

  const playRow = (id) => {
    const idx = playlistSongs.findIndex((s) => s.id === id);
    if (idx < 0) return;
    goTo(idx, { autoplay: true });
  };

  /* ---------------- Master Save ---------------- */

  const metaBasicsChosen = useMemo(
    () => !!albumName.trim() && !!artistName.trim() && !!releaseDate.trim(),
    [albumName, artistName, releaseDate]
  );

  // Require S3 key for cover (portable)
  const coverChosen = useMemo(
    () => !!coverFileName && !!coverS3Key,
    [coverFileName, coverS3Key]
  );

  const handleMasterSave = async () => {
    if (!projectId) return;

    if (!metaBasicsChosen) {
      window.alert("Master Save refused.\n\nFill Album Name, Artist Name, and Release Date.");
      return;
    }
    if (!coverChosen) {
      window.alert("Master Save refused.\n\nUpload an Album Cover (and let it finish uploading).");
      return;
    }

    const first = window.confirm(
      "Are you sure you want to perform a Master Save from Album?\n\nThis will write Album playlistOrder + album info + album media (portable S3 keys) to the snapshot."
    );
    if (!first) return;

    const second = window.confirm("Last chance.\n\nMake sure everything is complete.");
    if (!second) return;

    try {
      const r1 = await fetch(`${API_BASE}/api/master-save/latest/${projectId}`);
      const j1 = await r1.json();
      if (!r1.ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${r1.status}`);

      const currentProject = j1?.snapshot?.project || {};
      const nowIso = new Date().toISOString();

      const cover = {
        fileName: coverFileName,
        mime: coverMime || "image/*",
        bytes: Number(coverBytes || 0),
        sizeHint: DEFAULT_COVER_SIZE,
        s3Key: coverS3Key,
        // optional local pointer for preview/debug
        local: {
          storeKey: coverStoreKey || coverKey,
          storage: "indexeddb",
        },
      };

      const slideshow = (slideshowItems || []).map((x) => ({
        id: x.id,
        fileName: x.fileName,
        mime: x.mime,
        bytes: Number(x.bytes || 0),
        s3Key: x.s3Key || "",
        local: {
          storeKey: x.storeKey,
          storage: "indexeddb",
        },
      }));

      // ✅ NEW: persist song titles into snapshot (so they don’t vanish)
      const songTitles = Array.from({ length: SONG_COUNT }).map((_, idx) => {
        const slot = idx + 1;
        const row = (albumSongs || []).find((s) => Number(s.slot) === slot);
        const title = String(row?.title || "").trim();
        return { slot, title };
      });

      const nextAlbum = {
        ...(currentProject.album || {}),
        title: albumName,
        artist: artistName,
        releaseDate,
        bpm,
        genre,
        durationSeconds: Number(totalAlbumSeconds || 0),

        playlistOrder: [...albumPlaylistIds],

        // ✅ NEW: keep titles in album snapshot
        songTitles,

        media: {
          cover,
          slideshow,
        },
      };

      const nextProject = {
        ...currentProject,
        album: nextAlbum,

        // ✅ NEW: mark masterSave section status
        masterSave: {
          ...(currentProject.masterSave || {}),
          lastMasterSaveAt: nowIso,
          sections: {
            ...(currentProject.masterSave?.sections || {}),
            album: { complete: true, masterSavedAt: nowIso },
          },
        },
      };

      const r2 = await fetch(`${API_BASE}/api/master-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, project: nextProject }),
      });

      const j2 = await r2.json();
      if (!r2.ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${r2.status}`);

      setAlbumInfoLocked(true);
      setAlbumMetaLocked(true);
      setPlaylistLocked(true);

      window.alert("Album Master Save complete.\n\nplaylistOrder + album info + album media (S3 keys) written to snapshot.");
    } catch (e) {
      window.alert(`Master Save failed:\n\n${e?.message || String(e)}`);
    }
  };

  /* ---------------- render ---------------- */

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 12 }}>
        Project ID: <code>{projectId}</code>
        {token ? (
          <>
            {" "}
            · Link: <code>{token.slice(0, 10)}…</code>
          </>
        ) : null}
      </div>

      {/* Title */}
      <div>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Album</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Titles + playlist come from Album. Playback comes from Catalog <strong>Album</strong> files.
        </div>
      </div>

      {/* Load status */}
      {loading ? <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>Loading latest snapshot…</div> : null}

      {loadErr ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "#991b1b",
            background: "#fee2e2",
            border: "1px solid #fecaca",
            padding: 10,
            borderRadius: 12,
          }}
        >
          {loadErr}
        </div>
      ) : null}

      {/* Album Details + Assets */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <div style={sectionTitle()}>Album Details + Assets</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={lockBtn(albumInfoLocked)} onClick={() => setAlbumInfoLocked((v) => !v)}>
              {albumInfoLocked ? "Info Locked" : "Lock Info"}
            </button>
            <button type="button" style={lockBtn(albumMetaLocked)} onClick={() => setAlbumMetaLocked((v) => !v)}>
              {albumMetaLocked ? "Meta Locked" : "Lock Meta"}
            </button>
          </div>
        </div>

        {/* Compact form grid */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 2fr 1.2fr", gap: 12 }}>
          <div style={{ gridColumn: "span 2" }}>
            <Field label="Album Name">
              <input value={albumName} onChange={(e) => setAlbumName(e.target.value)} style={input()} disabled={albumInfoLocked} />
            </Field>
          </div>

          <Field label="Release Date">
            <input value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} style={input()} disabled={albumInfoLocked} />
          </Field>

          <div style={{ gridColumn: "span 2" }}>
            <Field label="Artist Name">
              <input value={artistName} onChange={(e) => setArtistName(e.target.value)} style={input()} disabled={albumInfoLocked} />
            </Field>
          </div>

          <Field label="BPM (album)">
            <input value={bpm} onChange={(e) => setBpm(e.target.value)} style={input()} disabled={albumMetaLocked} />
          </Field>

          <div style={{ gridColumn: "span 2" }}>
            <Field label="Genre">
              <input value={genre} onChange={(e) => setGenre(e.target.value)} style={input()} disabled={albumMetaLocked} />
            </Field>
          </div>

          <Field label="Total Duration">
            <input value={fmtTime(totalAlbumSeconds)} readOnly style={inputReadOnly()} />
          </Field>
        </div>

        {/* Assets row */}
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "300px 1fr", gap: 14 }}>
          {/* Cover */}
          <div style={{ ...subCard(), opacity: albumInfoLocked ? 0.92 : 1 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Album Cover</div>
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
              Default download size: <strong>{DEFAULT_COVER_SIZE}</strong>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
              <label style={uploadBtn(albumInfoLocked)}>
                + Upload Cover
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  disabled={albumInfoLocked}
                  onChange={(e) => {
                    pickCover(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
              </label>

              {coverFileName ? (
                <code style={{ fontSize: 11, opacity: 0.75 }} title={coverFileName}>
                  {shorten(coverFileName, 18)}
                </code>
              ) : (
                <span style={{ fontSize: 11, opacity: 0.6 }}>No cover uploaded</span>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 11, opacity: 0.75, display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                Cover bytes: <strong>{coverFileName ? fmtBytes(coverBytes) : "—"}</strong>
              </div>

              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  opacity: 0.85,
                  maxWidth: "100%",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  lineHeight: 1.25,
                }}
              >
                S3 key: {coverS3Key ? coverS3Key : "(not uploaded yet)"}
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                width: "100%",
                aspectRatio: "1 / 1",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {coverPreviewUrl ? (
                <img src={coverPreviewUrl} alt="Album cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ fontSize: 12, opacity: 0.55 }}>Cover preview</div>
              )}
            </div>
          </div>

          {/* Slideshow */}
          <div style={{ ...subCard(), opacity: albumInfoLocked ? 0.92 : 1 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Slideshow (images / PDF / video)</div>
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
              Max {SLIDESHOW_MAX}. Saved locally (IndexedDB). (Uploads to S3 best-effort.)
            </div>

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={uploadBtn(albumInfoLocked || slideshowItems.length >= SLIDESHOW_MAX)}>
                + Upload ({slideshowItems.length}/{SLIDESHOW_MAX})
                <input
                  type="file"
                  accept="image/*,application/pdf,video/*"
                  multiple
                  style={{ display: "none" }}
                  disabled={albumInfoLocked || slideshowItems.length >= SLIDESHOW_MAX}
                  onChange={(e) => {
                    addSlideshowFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>

              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {slideshowItems.length ? "Files listed below." : "No slideshow files added."}
              </div>
            </div>

            {slideshowItems.length ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {slideshowItems.map((it) => (
                  <div
                    key={it.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: "10px 10px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      background: "#fff",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color: "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {it.fileName || "—"}
                      </div>

                      <div style={{ marginTop: 3, fontSize: 11, opacity: 0.7 }}>
                        {it.mime || "file"} • {fmtBytes(it.bytes)}{" "}
                        {it.s3Key ? (
                          <span style={{ marginLeft: 8, fontFamily: "monospace" }}>✅ S3</span>
                        ) : (
                          <span style={{ marginLeft: 8, ...pillRed() }}>LOCAL ONLY</span>
                        )}
                      </div>

                      {it.s3Key ? (
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 10,
                            opacity: 0.65,
                            fontFamily: "monospace",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {it.s3Key}
                        </div>
                      ) : null}
                    </div>

                    <button type="button" style={dangerBtn()} onClick={() => removeSlideshowItem(it.id)} disabled={albumInfoLocked}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <SlideshowPreview items={slideshowItems} />
            </div>
          </div>
        </div>
      </div>

      {/* Main player */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Main Player</div>

        <div style={{ marginTop: 12, ...playerCard() }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 900 }}>
                Now Playing:{" "}
                {nowSong ? (
                  <span style={{ opacity: nowUrl ? 1 : 0.55 }}>
                    Song {nowSong.slot} — {nowSong.title}
                  </span>
                ) : (
                  <span style={{ opacity: 0.6 }}>—</span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                Audio source: Catalog <strong>Album</strong>
              </div>
            </div>

            <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>
              {fmtTime(t)} / {fmtTime(dur)}
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={primaryBtnSmall(!!nowUrl)} onClick={playPause}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button type="button" style={ghostBtn(false)} onClick={prev}>
              Prev
            </button>
            <button type="button" style={ghostBtn(false)} onClick={next}>
              Next
            </button>
            <button type="button" style={ghostBtn(false)} onClick={hardStop}>
              Reset
            </button>
          </div>

          <div
            onClick={scrub}
            style={{
              marginTop: 12,
              height: 12,
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "#f3f4f6",
              overflow: "hidden",
              cursor: dur ? "pointer" : "not-allowed",
              opacity: dur ? 1 : 0.6,
            }}
          >
            <div
              style={{
                width: `${dur ? Math.round((t / dur) * 100) : 0}%`,
                height: "100%",
                background: "#111827",
                opacity: 0.35,
              }}
            />
          </div>

          <audio ref={audioRef} src={nowUrl || undefined} onLoadedMetadata={onLoaded} onEnded={onEnded} />
        </div>
      </div>

      {/* Two-column */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        {/* Playlist (left) */}
        <div style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={sectionTitle()}>Album Playlist</div>
            <button type="button" style={lockBtn(playlistLocked)} onClick={() => setPlaylistLocked((v) => !v)}>
              {playlistLocked ? "Locked" : "Lock"}
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Drag to reorder. This order is saved into <strong>Album Master Save</strong> as <code>album.playlistOrder</code>.
          </div>

          <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
            {playlistSongs.map((s, i) => (
              <div
                key={s.id}
                draggable={!playlistLocked}
                onDragStart={() => onDragStart(s.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(s.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "42px 48px 1fr 260px",
                  gap: 10,
                  padding: "12px 12px",
                  borderBottom: i === playlistSongs.length - 1 ? "none" : "1px solid #e5e7eb",
                  background: dragId === s.id ? "#f3f4f6" : "#fff",
                  cursor: playlistLocked ? "default" : "grab",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 14, opacity: 0.55, textAlign: "center", userSelect: "none" }}>☰</div>

                <button
                  type="button"
                  onClick={() => playRow(s.id)}
                  disabled={!s.url}
                  style={rowPlayBtn(!!s.url)}
                  title={s.url ? "Play this song" : "Missing album audio"}
                >
                  ▶
                </button>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#0f172a",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                  }}
                  title={`${i + 1}. Song ${s.slot} — ${s.title}`}
                >
                  {i + 1}. Song {s.slot} — {s.title}
                </div>

                <div style={{ justifySelf: "end", textAlign: "right" }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    {s.fileName ? <code title={s.fileName}>{shorten(s.fileName, 28)}</code> : <span>—</span>}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.65 }}>
                    {durById[s.id] ? fmtTime(durById[s.id]) : "—"}
                  </div>
                </div>

                <DurationProbe id={s.id} url={s.url} onDuration={(sec) => onDuration(s.id, sec)} />
              </div>
            ))}
          </div>
        </div>

        {/* Master Save (right) */}
        <div style={{ display: "grid", gap: 14 }}>
          <div style={card()}>
            <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
              <strong>Master Save</strong> writes <code>album.playlistOrder</code> + album info + album media.
              <br />
              <br />
              ✅ Shop/Product need portable keys, so cover is saved as <code>album.media.cover.s3Key</code>.
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button type="button" style={primaryBtn()} onClick={handleMasterSave}>
                Master Save
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
              Snapshot loaded: {snapshot?.savedAt ? <code>{snapshot.savedAt}</code> : <span>—</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Slideshow preview ---------------- */

function SlideshowPreview({ items }) {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(false);

  const item = Array.isArray(items) && items.length ? items[Math.min(idx, items.length - 1)] : null;

  useEffect(() => {
    setIdx(0);
  }, [items?.length]);

  useEffect(() => {
    if (!auto) return;
    if (!items?.length) return;

    const t = setInterval(() => {
      setIdx((v) => {
        const next = v + 1;
        return next >= items.length ? 0 : next;
      });
    }, 2500);

    return () => clearInterval(t);
  }, [auto, items]);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>Slideshow Preview</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" style={ghostBtnSm(!items?.length)} disabled={!items?.length} onClick={() => setIdx((v) => Math.max(0, v - 1))}>
            Prev
          </button>
          <button
            type="button"
            style={ghostBtnSm(!items?.length)}
            disabled={!items?.length}
            onClick={() => setIdx((v) => (items?.length ? (v + 1) % items.length : 0))}
          >
            Next
          </button>
          <button type="button" style={ghostBtnSm(!items?.length)} disabled={!items?.length} onClick={() => setAuto((v) => !v)}>
            Auto: {auto ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
        {items?.length ? (
          <>
            Slide <strong>{idx + 1}</strong> / {items.length} — <strong>{item?.fileName || "—"}</strong>
          </>
        ) : (
          "No slides yet."
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <SlideRenderer item={item} />
      </div>
    </div>
  );
}

function SlideRenderer({ item }) {
  const [url, setUrl] = useState("");
  const leaseRef = useRef("");

  const revoke = () => {
    safeRevoke(leaseRef.current);
    leaseRef.current = "";
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      revoke();
      setUrl("");
      if (!item?.storeKey) return;

      const blob = await idbGetBlob(item.storeKey);
      if (!blob || cancelled) return;

      const u = URL.createObjectURL(blob);
      leaseRef.current = u;
      setUrl(u);
    }

    run();

    return () => {
      cancelled = true;
      revoke();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.storeKey]);

  if (!item) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          opacity: 0.6,
        }}
      >
        Preview
      </div>
    );
  }

  const mime = String(item?.mime || "");
  const isImg = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || mime.includes("pdf");
  const isVid = mime.startsWith("video/");

  if (!url) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          opacity: 0.6,
        }}
      >
        Loading…
      </div>
    );
  }

  if (isImg) {
    return (
      <div style={{ width: "100%", borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f8fafc" }}>
        <img src={url} alt={item.fileName} style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
    );
  }

  if (isPdf) {
    return (
      <div style={{ width: "100%", height: 420, borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f8fafc" }}>
        <iframe title={item.fileName} src={url} style={{ width: "100%", height: "100%", border: "none" }} />
      </div>
    );
  }

  if (isVid) {
    return <VideoPreview url={url} />;
  }

  return (
    <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#f8fafc", fontSize: 12, opacity: 0.75 }}>
      Unsupported preview type. (mime: <code>{mime || "—"}</code>)
    </div>
  );
}

function VideoPreview({ url }) {
  const vidRef = useRef(null);
  const rafRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(1);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setT(0);
    setDur(0);
    const v = vidRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = 0;
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const tick = () => {
    const v = vidRef.current;
    if (!v) return;
    setT(v.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  const onLoaded = () => {
    const v = vidRef.current;
    if (!v) return;
    setDur(v.duration || 0);
  };

  const onEnded = () => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const playPause = async () => {
    const v = vidRef.current;
    if (!v) return;

    if (playing) {
      v.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    try {
      await v.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setPlaying(false);
    }
  };

  const reset = () => {
    const v = vidRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    setT(0);
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const scrub = (e) => {
    const v = vidRef.current;
    if (!v || !dur) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;

    v.currentTime = dur * pct;
    setT(v.currentTime);
  };

  const toggleMute = () => {
    const v = vidRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
  };

  const setVolume = (next) => {
    const v = vidRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, Number(next)));
    v.volume = clamped;
    setVol(clamped);
  };

  return (
    <div>
      <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb", background: "#000" }}>
        <video ref={vidRef} src={url} style={{ width: "100%", height: "auto", display: "block" }} onLoadedMetadata={onLoaded} onEnded={onEnded} />
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}>
          {fmtTime(t)} / {fmtTime(dur)}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={primaryBtnSmall(true)} onClick={playPause}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" style={ghostBtnSm(false)} onClick={reset}>
            Reset
          </button>
          <button type="button" style={ghostBtnSm(false)} onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.75 }}>Vol</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} onChange={(e) => setVolume(e.target.value)} style={{ width: 120 }} />
          </div>
        </div>
      </div>

      <div
        onClick={scrub}
        style={{
          marginTop: 10,
          height: 12,
          borderRadius: 999,
          border: "1px solid #e5e7eb",
          background: "#f3f4f6",
          overflow: "hidden",
          cursor: dur ? "pointer" : "not-allowed",
          opacity: dur ? 1 : 0.6,
        }}
      >
        <div style={{ width: `${dur ? Math.round((t / dur) * 100) : 0}%`, height: "100%", background: "#111827", opacity: 0.35 }} />
      </div>
    </div>
  );
}

/* ---------------- duration probe (no UI) ---------------- */

function DurationProbe({ id, url, onDuration }) {
  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    try {
      const a = new Audio();
      a.preload = "metadata";
      a.src = url;

      const onMeta = () => {
        if (cancelled) return;
        onDuration?.(Number(a.duration) || 0);
        cleanup();
      };

      const onErr = () => {
        if (cancelled) return;
        onDuration?.(0);
        cleanup();
      };

      const cleanup = () => {
        a.removeEventListener("loadedmetadata", onMeta);
        a.removeEventListener("error", onErr);
      };

      a.addEventListener("loadedmetadata", onMeta);
      a.addEventListener("error", onErr);

      return () => {
        cancelled = true;
        cleanup();
      };
    } catch {
      onDuration?.(0);
    }
  }, [id, url, onDuration]);

  return null;
}
