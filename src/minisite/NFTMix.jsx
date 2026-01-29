// FILE: src/minisite/NFTMix.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE as API_BASE_ENV, requireApiBase } from "../lib/api/apiBase.js";

const SONG_COUNT = 9;

export default function NFTMix() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  // Canonical env var: VITE_API_BASE (legacy VITE_BACKEND_URL supported in apiBase.js)
  const API_BASE = String(API_BASE_ENV || "").replace(/\/+$/, "");
  const storageKey = (k) => `sb:${projectId}:nftmix:${k}`;

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  // songs in album playlist order: [{slot, title, aS3Key, aUrl}]
  const [songs, setSongs] = useState([]);

  // glue lines (album order)
  // IMPORTANT: we store bridge in S3, not base64
  // [{id, fromSlot, toSlot, locked, bridgeFileName, bridgeS3Key, bridgePlaybackUrl}]
  const [glueLines, setGlueLines] = useState(() =>
    Array.from({ length: SONG_COUNT - 1 }).map((_, i) => ({
      id: `glue-${i + 1}-to-${i + 2}`,
      fromSlot: i + 1,
      toSlot: i + 2,
      locked: false,
      bridgeFileName: "",
      bridgeS3Key: "",
      bridgePlaybackUrl: "",
    }))
  );

  // Master save UI state (kept)
  const [msLoading, setMsLoading] = useState(false);
  const [msErr, setMsErr] = useState("");
  const [msOk, setMsOk] = useState(null); // { savedAt, snapshotKey }

  /* ---------------- local project helpers ---------------- */

  const projectStorageKey = (pid) => `project_${pid}`;

  function loadProjectLocal(pid) {
    if (!pid) return null;
    const raw = localStorage.getItem(projectStorageKey(pid));
    const parsed = raw ? safeParse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  function saveProjectLocal(pid, obj) {
    if (!pid) return;
    localStorage.setItem(projectStorageKey(pid), JSON.stringify(obj || {}));
  }

  function persistGlueLines(nextGlue) {
    if (!projectId) return;

    // 1) write to sb cache
    try {
      localStorage.setItem(storageKey("glueLines"), JSON.stringify(nextGlue));
    } catch (e) {
      console.warn("Failed writing sb glueLines:", e);
    }

    // 2) write to project blob (SOURCE OF TRUTH)
    try {
      const nowIso = new Date().toISOString();
      const proj = loadProjectLocal(projectId) || { projectId, createdAt: nowIso };
      const nextProj = {
        ...proj,
        projectId: proj.projectId || projectId,
        updatedAt: nowIso,
        nftMix: {
          ...(proj.nftMix || {}),
          glueLines: nextGlue,
        },
      };
      saveProjectLocal(projectId, nextProj);
    } catch (e) {
      console.error("Failed writing project blob nftMix.glueLines:", e);
    }
  }

  function hydrateGlueLines() {
    if (!projectId) return;

    // 1) project blob first (truth)
    const proj = loadProjectLocal(projectId);
    const fromProject = Array.isArray(proj?.nftMix?.glueLines) ? proj.nftMix.glueLines : null;
    if (fromProject?.length) {
      setGlueLines(sanitizeGlueLines(fromProject));
      return;
    }

    // 2) fallback to sb cache
    const saved = readJSON(storageKey("glueLines"), null);
    if (Array.isArray(saved) && saved.length) {
      setGlueLines(sanitizeGlueLines(saved));
      return;
    }

    // 3) default seed
    setGlueLines(
      Array.from({ length: SONG_COUNT - 1 }).map((_, i) => ({
        id: `glue-${i + 1}-to-${i + 2}`,
        fromSlot: i + 1,
        toSlot: i + 2,
        locked: false,
        bridgeFileName: "",
        bridgeS3Key: "",
        bridgePlaybackUrl: "",
      }))
    );
  }

  function sanitizeGlueLines(arr) {
    const safe = (Array.isArray(arr) ? arr : []).map((l) => ({
      id: String(l?.id || `glue-${Number(l?.fromSlot) || 0}-to-${Number(l?.toSlot) || 0}`),
      fromSlot: Number(l?.fromSlot) || 0,
      toSlot: Number(l?.toSlot) || 0,
      locked: !!l?.locked,
      bridgeFileName: String(l?.bridgeFileName || ""),
      bridgeS3Key: String(l?.bridgeS3Key || ""),
      bridgePlaybackUrl: String(l?.bridgePlaybackUrl || ""),
    }));

    if (!safe.length) {
      return Array.from({ length: SONG_COUNT - 1 }).map((_, i) => ({
        id: `glue-${i + 1}-to-${i + 2}`,
        fromSlot: i + 1,
        toSlot: i + 2,
        locked: false,
        bridgeFileName: "",
        bridgeS3Key: "",
        bridgePlaybackUrl: "",
      }));
    }

    return safe;
  }

  /* ---------------- hydrate glueLines on projectId ---------------- */

  useEffect(() => {
    if (!projectId) return;
    hydrateGlueLines();

    const proj = loadProjectLocal(projectId);
    const savedAt = safeString(proj?.nftMix?.masterSave?.savedAt);
    const snapshotKey = safeString(proj?.nftMix?.masterSave?.snapshotKey);
    if (savedAt || snapshotKey) setMsOk({ savedAt: savedAt || "", snapshotKey: snapshotKey || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist on change (locks INCLUDED)
  useEffect(() => {
    if (!projectId) return;
    persistGlueLines(glueLines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glueLines, projectId]);

  /* ---------------- Load snapshot (Album order + Catalog A audio) ---------------- */

  useEffect(() => {
    if (!projectId) return;

    try {
      requireApiBase(API_BASE);
    } catch (e) {
      setLoadErr(e?.message || "Missing VITE_API_BASE");
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadErr("");

      try {
        const base = requireApiBase(API_BASE);

        const r = await fetch(`${base}/api/master-save/latest/${projectId}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (cancelled) return;

        const project = j?.snapshot?.project || j?.snapshot?.snapshot?.project || j?.snapshot?.project || {};
        const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
        const albumSongTitles = Array.isArray(project?.album?.songTitles) ? project.album.songTitles : [];
        const playlistOrder = Array.isArray(project?.album?.playlistOrder) ? project.album.playlistOrder : null;

        const orderedSlots =
          Array.isArray(playlistOrder) && playlistOrder.length
            ? playlistOrder
                .map((id) => {
                  const m = String(id).match(/^slot-(\d+)$/);
                  return m ? Number(m[1]) : null;
                })
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= SONG_COUNT)
            : Array.from({ length: SONG_COUNT }).map((_, i) => i + 1);

        const baseSongs = orderedSlots.map((slot) => {
          const aTitle = albumSongTitles.find((x) => Number(x.slot) === slot);
          const cSong =
            catalogSongs.find((x) => Number(x.songNumber) === slot) ||
            catalogSongs.find((x) => Number(x.slot) === slot);

          const title = String(aTitle?.title || cSong?.title || "").trim() || `Song ${slot}`;

          const aS3Key =
            String(cSong?.versions?.A?.s3Key || "").trim() ||
            String(cSong?.files?.a?.s3Key || "").trim() ||
            String(cSong?.files?.A?.s3Key || "").trim() ||
            "";

          return { slot, title, aS3Key, aUrl: "" };
        });

        const withUrls = await Promise.all(
          baseSongs.map(async (s) => {
            if (!s.aS3Key) return s;
            const url = await fetchPlaybackUrl(API_BASE, s.aS3Key);
            return { ...s, aUrl: url || "" };
          })
        );

        if (cancelled) return;
        setSongs(withUrls);

        // Rebuild glue lines to match album order, preserving saved bridges/locks by pair
        setGlueLines((prev) => {
          const prevMap = new Map(prev.map((p) => [`${p.fromSlot}->${p.toSlot}`, p]));
          const next = [];

          for (let i = 0; i < orderedSlots.length - 1; i++) {
            const fromSlot = orderedSlots[i];
            const toSlot = orderedSlots[i + 1];
            const key = `${fromSlot}->${toSlot}`;
            const id = `glue-${fromSlot}-to-${toSlot}`;

            const existing = prevMap.get(key);
            if (existing) {
              next.push({
                ...existing,
                id,
                fromSlot,
                toSlot,
              });
            } else {
              next.push({
                id,
                fromSlot,
                toSlot,
                locked: false,
                bridgeFileName: "",
                bridgeS3Key: "",
                bridgePlaybackUrl: "",
              });
            }
          }
          return next;
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

  /* ---------------- song helpers ---------------- */

  const titleForSlot = (slot) => songs.find((x) => Number(x.slot) === Number(slot))?.title || `Song ${slot}`;
  const songAUrlForSlot = (slot) => songs.find((x) => Number(x.slot) === Number(slot))?.aUrl || "";

  /* ---------------- Bridge upload (S3) + lock ---------------- */

  const handlePickBridge = async (idx, file) => {
    if (!file) return;
    if (!projectId) return;

    // Static-site rule: do not upload from smartbridge2
    window.alert("upload-to-s3 disabled on smartbridge2 (static site). Upload in publisher/admin backend.");
    return;

    // (intentionally unreachable in static-site build)
    // eslint-disable-next-line no-unreachable
  };

  const toggleLock = (idx) => {
    setGlueLines((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], locked: !copy[idx].locked };
      return copy;
    });
  };

  /* ---------------- Build ONE playable timeline (prefix until missing) ---------------- */

  const segments = useMemo(() => {
    const out = [];
    if (!songs.length) return out;

    const orderedSlots = songs.map((s) => Number(s.slot)).filter((n) => Number.isFinite(n));
    if (!orderedSlots.length) return out;

    const firstSlot = orderedSlots[0];
    const firstUrl = songAUrlForSlot(firstSlot);
    if (!firstUrl) return out;

    out.push({
      key: `song-${firstSlot}`,
      type: "song",
      fromSlot: firstSlot,
      toSlot: null,
      label: `Song ${firstSlot} — ${titleForSlot(firstSlot)}`,
      url: firstUrl,
    });

    for (let i = 0; i < orderedSlots.length - 1; i++) {
      const fromSlot = orderedSlots[i];
      const toSlot = orderedSlots[i + 1];

      const bridge = glueLines.find((l) => Number(l.fromSlot) === fromSlot && Number(l.toSlot) === toSlot);
      const bridgeUrl = String(bridge?.bridgePlaybackUrl || "").trim();
      const nextSongUrl = songAUrlForSlot(toSlot);

      if (!bridgeUrl || !nextSongUrl) break;

      out.push({
        key: `bridge-${fromSlot}-${toSlot}`,
        type: "bridge",
        fromSlot,
        toSlot,
        label: `Bridge ${fromSlot}→${toSlot}`,
        url: bridgeUrl,
      });

      out.push({
        key: `song-${toSlot}`,
        type: "song",
        fromSlot: toSlot,
        toSlot: null,
        label: `Song ${toSlot} — ${titleForSlot(toSlot)}`,
        url: nextSongUrl,
      });
    }

    return out;
  }, [songs, glueLines]); // eslint-disable-line react-hooks/exhaustive-deps

  const playableLabel = useMemo(() => {
    if (!segments.length) return "Nothing playable yet (need Song 1 A).";
    const last = segments[segments.length - 1];
    return `Playable now: ${segments[0]?.label || ""} → … → ${last?.label || ""}`;
  }, [segments]);

  /* ---------------- Global player engine (single <audio>) ---------------- */

  const audioRef = useRef(null);
  const rafRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [segIdx, setSegIdx] = useState(0);
  const [segT, setSegT] = useState(0);
  const [durByKey, setDurByKey] = useState({});

  const activeSeg = segments[segIdx] || null;

  const stopRaf = () => {
    try {
      cancelAnimationFrame(rafRef.current);
    } catch {}
  };

  const tick = () => {
    const el = audioRef.current;
    if (!el) return;
    setSegT(el.currentTime || 0);
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    let cancelled = false;

    async function preloadDurations() {
      for (const s of segments) {
        if (cancelled) return;
        if (durByKey[s.key]) continue;
        if (!s.url) continue;

        const d = await probeDuration(s.url);
        if (cancelled) return;
        if (d) setDurByKey((prev) => ({ ...prev, [s.key]: d }));
      }
    }

    preloadDurations();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.map((x) => x.key).join("|")]);

  const totalPlayableSeconds = useMemo(() => {
    return segments.reduce((sum, s) => sum + (Number(durByKey[s.key]) || 0), 0);
  }, [segments, durByKey]);

  const globalTime = useMemo(() => {
    let t = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const d = Number(durByKey[s.key]) || 0;
      if (i < segIdx) t += d;
      else if (i === segIdx) t += Math.min(d || 0, Number(segT) || 0);
    }
    return t;
  }, [segments, durByKey, segIdx, segT]);

  const loadSegment = (idx, { autoplay = false, seekSeconds = 0 } = {}) => {
    const el = audioRef.current;
    if (!el) return;

    const s = segments[idx];
    if (!s?.url) return;

    stopRaf();
    el.pause();

    el.src = s.url;
    el.load();

    setSegIdx(idx);
    setSegT(0);

    el.onloadedmetadata = () => {
      const d = Number(el.duration) || 0;
      setDurByKey((prev) => ({ ...prev, [s.key]: d }));

      const safeSeek = Math.max(0, Math.min(d || 0, Number(seekSeconds) || 0));
      if (safeSeek) {
        try {
          el.currentTime = safeSeek;
          setSegT(el.currentTime || 0);
        } catch {}
      }

      if (autoplay) {
        el.play()
          .then(() => {
            setIsPlaying(true);
            stopRaf();
            rafRef.current = requestAnimationFrame(tick);
          })
          .catch(() => setIsPlaying(false));
      }
    };

    el.onended = () => {
      if (idx < segments.length - 1) loadSegment(idx + 1, { autoplay: true, seekSeconds: 0 });
      else {
        setIsPlaying(false);
        stopRaf();
      }
    };
  };

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!segments.length) return;

    if (!el.getAttribute("src")) {
      loadSegment(0, { autoplay: true, seekSeconds: 0 });
      return;
    }

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      stopRaf();
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setIsPlaying(false);
    }
  };

  const reset = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {}
    setIsPlaying(false);
    stopRaf();
    setSegT(0);
  };

  /* ---------------- Scrub: click + DRAG ---------------- */

  const dragRef = useRef({ dragging: false });

  const seekGlobalSeconds = (targetSeconds) => {
    if (!segments.length) return;
    if (!totalPlayableSeconds) return;

    const target = Math.max(0, Math.min(totalPlayableSeconds, Number(targetSeconds) || 0));

    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const d = Number(durByKey[s.key]) || 0;
      if (!d) break;

      if (target <= acc + d) {
        const offset = target - acc;
        const el = audioRef.current;

        if (i === segIdx && el && el.getAttribute("src")) {
          try {
            el.currentTime = Math.max(0, Math.min(d, offset));
            setSegT(el.currentTime || 0);
          } catch {}
          return;
        }

        loadSegment(i, { autoplay: isPlaying, seekSeconds: offset });
        return;
      }
      acc += d;
    }
  };

  const pointerToGlobalSeconds = (e, rect) => {
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = rect.width ? x / rect.width : 0;
    return totalPlayableSeconds * pct;
  };

  const onScrubPointerDown = (e) => {
    if (!totalPlayableSeconds) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();

    dragRef.current.dragging = true;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {}

    const target = pointerToGlobalSeconds(e, rect);
    seekGlobalSeconds(target);
  };

  const onScrubPointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    if (!totalPlayableSeconds) return;

    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();

    const target = pointerToGlobalSeconds(e, rect);
    seekGlobalSeconds(target);
  };

  const onScrubPointerUp = (e) => {
    const el = e.currentTarget;
    dragRef.current.dragging = false;
    try {
      el.releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  /* ---------------- Bridge row Play/Pause ---------------- */

  const isActiveBridge = (fromSlot, toSlot) => {
    return (
      activeSeg &&
      activeSeg.type === "bridge" &&
      Number(activeSeg.fromSlot) === Number(fromSlot) &&
      Number(activeSeg.toSlot) === Number(toSlot)
    );
  };

  const toggleBridgeRow = (fromSlot, toSlot, bridgeUrl) => {
    if (!bridgeUrl) return;

    if (isActiveBridge(fromSlot, toSlot) && isPlaying) {
      const el = audioRef.current;
      if (!el) return;
      el.pause();
      setIsPlaying(false);
      stopRaf();
      return;
    }

    if (isActiveBridge(fromSlot, toSlot) && !isPlaying) {
      const el = audioRef.current;
      if (!el) return;
      el.play()
        .then(() => {
          setIsPlaying(true);
          stopRaf();
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => setIsPlaying(false));
      return;
    }

    const idxSeg = segments.findIndex(
      (s) => s.type === "bridge" && Number(s.fromSlot) === Number(fromSlot) && Number(s.toSlot) === Number(toSlot)
    );

    if (idxSeg >= 0) {
      loadSegment(idxSeg, { autoplay: true, seekSeconds: 0 });
      return;
    }

    const el = audioRef.current;
    if (!el) return;
    stopRaf();
    el.pause();
    el.src = bridgeUrl;
    el.load();
    setSegIdx(0);
    setSegT(0);

    el.onloadedmetadata = () => {
      el.play()
        .then(() => {
          setIsPlaying(true);
          stopRaf();
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => setIsPlaying(false));
    };

    el.onended = () => {
      setIsPlaying(false);
      stopRaf();
    };
  };

  /* ---------------- NFT MIX MASTER SAVE ---------------- */

  const safeGlueLinesForSave = useMemo(() => {
    return (glueLines || []).map((l) => ({
      id: String(l.id || ""),
      fromSlot: Number(l.fromSlot) || 0,
      toSlot: Number(l.toSlot) || 0,
      locked: !!l.locked,
      bridgeFileName: String(l.bridgeFileName || ""),
      bridgeS3Key: String(l.bridgeS3Key || ""),
      bridgePlaybackUrl: String(l.bridgePlaybackUrl || ""),
    }));
  }, [glueLines]);

  const handleMasterSave = async () => {
    if (!projectId) return;

    // Static-site rule: do not master-save from smartbridge2
    window.alert("Master Save disabled on smartbridge2 (static site). Use publisher/admin backend.");
    return;
  };

  /* ---------------- UI ---------------- */

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 12 }}>
        Project ID: <code>{projectId}</code>
        {token ? (
          <>
            {" "}
            · Link: <code>{token.slice(0, 10)}…</code>
          </>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>NFT Mix</div>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Giveaway MP3: <strong>Song A + Bridge + Song A</strong> continuous (Album order). Source defaults to{" "}
            <strong>Version A</strong>.
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
            Bridges/locks are saved in your <code>project_{projectId}</code> blob.
          </div>

          {loading ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Loading Album → NFT Mix…</div> : null}
          {loadErr ? <div style={{ marginTop: 8, ...errorBox() }}>{loadErr}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 12, opacity: 0.75, alignItems: "flex-end" }}>
          <div>
            # of Songs: <strong>{songs.length || SONG_COUNT}</strong>
          </div>
          <div>
            Playable Time: <strong>{fmtTime(totalPlayableSeconds)}</strong>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>NFT Mix Player</div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
          {playableLabel}
          {activeSeg ? (
            <>
              <span style={{ opacity: 0.6 }}> · </span>
              <span style={{ fontWeight: 900 }}>Now Playing:</span> {activeSeg.label}
            </>
          ) : null}
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={togglePlay} style={primaryBtn(!segments.length)}>
            {isPlaying ? "Pause" : "Play"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.7, minWidth: 130 }}>
            {fmtTime(globalTime)} / {fmtTime(totalPlayableSeconds)}
          </div>

          <div
            onPointerDown={onScrubPointerDown}
            onPointerMove={onScrubPointerMove}
            onPointerUp={onScrubPointerUp}
            onPointerCancel={onScrubPointerUp}
            title={!totalPlayableSeconds ? "Waiting for durations…" : "Drag to scrub the playable mix"}
            style={{
              flex: 1,
              height: 26,
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "#f3f4f6",
              overflow: "hidden",
              cursor: totalPlayableSeconds ? "grab" : "not-allowed",
              opacity: segments.length ? 1 : 0.6,
              display: "flex",
              alignItems: "center",
              padding: "0 6px",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <div
              style={{
                width: totalPlayableSeconds ? `${Math.round((globalTime / totalPlayableSeconds) * 100)}%` : "0%",
                height: 14,
                borderRadius: 999,
                background: "#111827",
                opacity: 0.35,
              }}
            />
          </div>

          <button type="button" onClick={reset} style={resetBtn()}>
            Reset
          </button>
        </div>

        <audio ref={audioRef} />
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Glue / Bridge Lines</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Upload + Master Save are disabled on static site. Locks still persist locally.
        </div>

        <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2.6fr 1.2fr",
              padding: "10px 12px",
              background: "#f8fafc",
              borderBottom: "1px solid #e5e7eb",
              fontSize: 11,
              fontWeight: 900,
              opacity: 0.75,
              textTransform: "uppercase",
              letterSpacing: 0.2,
              gap: 10,
              alignItems: "center",
            }}
          >
            <div>From</div>
            <div style={{ textAlign: "center" }}>Bridge</div>
            <div style={{ textAlign: "right" }}>To</div>
          </div>

          {glueLines.map((line, idx) => {
            const bridgeUrl = String(line.bridgePlaybackUrl || "").trim();
            const bridgePlayable = !!bridgeUrl;
            const bridgeActive = isActiveBridge(line.fromSlot, line.toSlot);
            const showPause = bridgeActive && isPlaying;

            return (
              <div
                key={line.id}
                style={{
                  padding: "12px 12px",
                  borderBottom: idx === glueLines.length - 1 ? "none" : "1px solid #e5e7eb",
                  background: bridgeActive ? "rgba(17,24,39,0.04)" : "#fff",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2.6fr 1.2fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", minWidth: 0 }}>
                    Song {line.fromSlot} — {titleForSlot(line.fromSlot)}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={plusPill()}>+</div>

                      <label style={uploadBtn(true)} title="Disabled on static site">
                        Upload Bridge
                        <input type="file" accept="audio/*" disabled style={{ display: "none" }} />
                      </label>

                      <div style={{ fontSize: 12, opacity: 0.75, minWidth: 220 }}>
                        {line.bridgeFileName ? <code style={{ wordBreak: "break-word" }}>{line.bridgeFileName}</code> : "—"}
                      </div>

                      <button
                        type="button"
                        title={bridgePlayable ? "Play/Pause bridge (global player)" : "No playback URL"}
                        onClick={() => toggleBridgeRow(line.fromSlot, line.toSlot, bridgeUrl)}
                        style={tinyPlayBtn(bridgePlayable)}
                      >
                        {showPause ? "⏸" : "▶"}
                      </button>

                      <div style={plusPill()}>+</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", textAlign: "right", minWidth: 0 }}>
                      Song {line.toSlot} — {titleForSlot(line.toSlot)}
                    </div>

                    <button type="button" onClick={() => toggleLock(idx)} style={lockBtn(line.locked)}>
                      {line.locked ? "Locked" : "Unlock"}
                    </button>
                  </div>
                </div>

                {line.locked ? (
                  <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                    ✅ Locked: will persist across refresh.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, ...card() }}>
        <div style={sectionTitle()}>Master Save</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
          Disabled on smartbridge2 static site. Use publisher/admin backend.
        </div>

        {msErr ? <div style={{ marginTop: 10, ...errorBox() }}>{msErr}</div> : null}

        {msOk ? (
          <div style={{ marginTop: 10, ...okBox() }}>
            <div>
              <strong>NFT Mix Master Saved.</strong>
            </div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              Saved At: <code>{msOk.savedAt || ""}</code>
            </div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              Snapshot Key: <code>{msOk.snapshotKey || "—"}</code>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={handleMasterSave} disabled style={primaryBtn(true)}>
            Master Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- API ---------------- */

async function fetchPlaybackUrl(API_BASE, s3Key) {
  // Uses current file’s helper; base validation is done before calls
  const base = requireApiBase(API_BASE);
  const qs = new URLSearchParams({ s3Key });
  const r = await fetch(`${base}/api/playback-url?${qs.toString()}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) return "";
  return String(j.url || "");
}

/* ---------------- duration probe ---------------- */

function probeDuration(url) {
  return new Promise((resolve) => {
    try {
      const a = new Audio();
      a.preload = "metadata";
      a.src = url;
      const done = (v) => {
        a.onloadedmetadata = null;
        a.onerror = null;
        resolve(Number(v) || 0);
      };
      a.onloadedmetadata = () => done(a.duration || 0);
      a.onerror = () => done(0);
    } catch {
      resolve(0);
    }
  });
}

/* ---------------- small helpers ---------------- */

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeString(v) {
  return String(v ?? "").trim();
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function fmtTime(s) {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* ---------------- styles ---------------- */

function card() {
  return { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}

function sectionTitle() {
  return { fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase" };
}

function primaryBtn(disabled) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: disabled ? "#e5e7eb" : "#111827",
    color: disabled ? "#6b7280" : "#f9fafb",
    fontSize: 13,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };
}

function uploadBtn(locked) {
  return {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: 10,
    background: locked ? "#e5e7eb" : "#d1fae5",
    color: locked ? "#6b7280" : "#065f46",
    fontSize: 12,
    fontWeight: 900,
    cursor: locked ? "not-allowed" : "pointer",
    border: locked ? "1px solid #d1d5db" : "1px solid #a7f3d0",
    whiteSpace: "nowrap",
  };
}

function lockBtn(locked) {
  const base = { padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 900, cursor: "pointer" };
  if (!locked) return { ...base, border: "1px solid #a7f3d0", background: "#d1fae5", color: "#065f46" };
  return { ...base, border: "1px solid #fecaca", background: "#fee2e2", color: "#991b1b" };
}

function plusPill() {
  return {
    width: 26,
    height: 26,
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 900,
    opacity: 0.7,
    userSelect: "none",
  };
}

function resetBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function tinyPlayBtn(enabled) {
  return {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function okBox() {
  return {
    fontSize: 12,
    color: "#065f46",
    background: "#d1fae5",
    border: "1px solid #a7f3d0",
    padding: 10,
    borderRadius: 12,
  };
}

function errorBox() {
  return {
    fontSize: 12,
    color: "#991b1b",
    background: "#fee2e2",
    border: "1px solid #fecaca",
    padding: 10,
    borderRadius: 12,
  };
}
