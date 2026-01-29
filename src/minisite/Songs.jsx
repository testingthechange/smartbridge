// FILE: src/minisite/Songs.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSongsMasterSave } from "./songs/useSongsMasterSave";
import { BridgePreviewPlayer, ABCTimelinePlayer } from "./songs/components/Players";
import { loadProject, saveProject } from "./catalog/catalogCore.js";
import { requireApiBase, API_BASE as API_BASE_ENV } from "../lib/api/apiBase.js";

const SONG_COUNT = 9;
const MASTER_SAVE_MIN_SHEETS = 8; // allow Master Save once 8/9 (or 9/9) worksheets are complete
const MAX_BRIDGE_BYTES = 50 * 1024 * 1024; // 50MB

export default function Songs() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  // Canonical env var: VITE_API_BASE (legacy VITE_BACKEND_URL supported in apiBase.js)
  const API_BASE = String(API_BASE_ENV || "").replace(/\/+$/, "");
  const sk = (k) => `sb:${projectId || "no-project"}:songs:${k}`;

  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [catalog, setCatalog] = useState([]);

  // ✅ inject EQ keyframes locally (no global CSS needed)
  useEffect(() => {
    ensureEqKeyframes();
  }, []);

  // single worksheet view
  const [currentFromSlot, setCurrentFromSlot] = useState(() => {
    const v = readTextSafe(sk("currentFromSlot"), "1");
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= SONG_COUNT ? n : 1;
  });

  // row selection inside worksheet
  const [activeToSlot, setActiveToSlot] = useState(() => {
    const v = readTextSafe(sk("activeToSlot"), "2");
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= SONG_COUNT ? n : 2;
  });

  useEffect(() => writeTextSafe(sk("currentFromSlot"), String(currentFromSlot)), [projectId, currentFromSlot]);
  useEffect(() => writeTextSafe(sk("activeToSlot"), String(activeToSlot)), [projectId, activeToSlot]);

  // --- Master Save 2-step confirm ---
  const [msStep, setMsStep] = useState(0);
  const openMasterSave = () => setMsStep(1);
  const closeMasterSave = () => setMsStep(0);
  const confirmMasterSaveStep1 = () => setMsStep(2);
  const confirmMasterSaveFinal = async () => {
    closeMasterSave();
    await doMasterSave();
  };

  /* ---------------- worksheet storage (pairKey = "from->to") ---------------- */

  const pairKey = (from, to) => `${Number(from)}->${Number(to)}`;
  const isValidSlot = (n) => Number.isFinite(n) && n >= 1 && n <= SONG_COUNT;

  // { [pairKey]: { bridgeFileName, bridgeStoreKey } }
  const [bridgeMap, setBridgeMap] = useState(() => {
    const saved = readJSONSafe(sk("bridgesByPair"), null);
    return saved && typeof saved === "object" ? saved : {};
  });
  useEffect(() => writeJSONSafe(sk("bridgesByPair"), bridgeMap || {}), [projectId, bridgeMap]);

  // { [pairKey]: true|false }
  const [lockMap, setLockMap] = useState(() => {
    const saved = readJSONSafe(sk("locksByPair"), null);
    return saved && typeof saved === "object" ? saved : {};
  });
  useEffect(() => writeJSONSafe(sk("locksByPair"), lockMap || {}), [projectId, lockMap]);

  // { [pairKey]: "A"|"B" }
  const [toListenChoice, setToListenChoice] = useState(() => {
    const saved = readJSONSafe(sk("toListenChoiceByPair"), null);
    return saved && typeof saved === "object" ? saved : {};
  });
  useEffect(() => writeJSONSafe(sk("toListenChoiceByPair"), toListenChoice || {}), [projectId, toListenChoice]);

  /**
   * Legacy: worksheetSaved used to be manual ON/OFF and could drift from truth.
   * Keep it, but auto-sync from derived completion.
   */
  const [worksheetSaved, setWorksheetSaved] = useState(() => {
    const saved = readJSONSafe(sk("worksheetSaved"), null);
    return saved && typeof saved === "object" ? saved : {};
  });
  useEffect(() => writeJSONSafe(sk("worksheetSaved"), worksheetSaved || {}), [projectId, worksheetSaved]);

  /**
   * ✅ Derived “worksheet complete” map: complete only when ALL domes in worksheet are locked.
   */
  const worksheetLockedMap = useMemo(() => {
    const m = {};
    for (let from = 1; from <= SONG_COUNT; from++) {
      let allLocked = true;
      for (let to = 1; to <= SONG_COUNT; to++) {
        if (to === from) continue;
        const k = pairKey(from, to);
        if (!lockMap?.[k]) {
          allLocked = false;
          break;
        }
      }
      m[String(from)] = allLocked;
    }
    return m;
  }, [lockMap]);

  // Auto-sync legacy worksheetSaved to truth (prevents “checked with no validated”)
  useEffect(() => {
    setWorksheetSaved((prev) => {
      const next = { ...(prev || {}) };
      let changed = false;
      for (let i = 1; i <= SONG_COUNT; i++) {
        const key = String(i);
        const truthy = !!worksheetLockedMap?.[key];
        if (!!next[key] !== truthy) {
          next[key] = truthy;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [worksheetLockedMap]);

  const savedCount = useMemo(() => {
    let c = 0;
    for (let i = 1; i <= SONG_COUNT; i++) if (worksheetLockedMap?.[String(i)]) c++;
    return c;
  }, [worksheetLockedMap]);

  const canMasterSave = savedCount >= MASTER_SAVE_MIN_SHEETS;

  /* ---------------- derived connections array ---------------- */

  const [connections, setConnections] = useState(() => {
    const rows = [];
    const bm = readJSONSafe(sk("bridgesByPair"), null) || {};
    const lm = readJSONSafe(sk("locksByPair"), null) || {};
    for (let from = 1; from <= SONG_COUNT; from++) {
      for (let to = 1; to <= SONG_COUNT; to++) {
        if (to === from) continue;
        const k = pairKey(from, to);
        const b = bm[k] || {};
        const locked = !!lm[k];
        rows.push({
          key: k,
          fromSlot: from,
          toSlot: to,
          locked,
          bridgeFileName: String(b.bridgeFileName || ""),
          bridgeStoreKey: String(b.bridgeStoreKey || ""),
          bridgeUrl: "",
        });
      }
    }
    return rows;
  });

  useEffect(() => {
    setConnections((prev) => prev.map((r) => ({ ...r, locked: !!lockMap?.[r.key] })));
  }, [lockMap]);

  /* ---------------- Master Save hook ---------------- */

  const { masterSaving, masterSaveMsg, doMasterSave } = useSongsMasterSave({
    projectId,
    token,
    apiBase: API_BASE,
    connections,
    toListenChoice,
    lockMap,
    bridgeMap,
    worksheetSaved: worksheetLockedMap, // ✅ truth
  });

  /* ---------------- hydrate bridge blob URLs for current worksheet ---------------- */

  const urlLeaseRef = useRef(new Map()); // pairKey -> blobUrl

  const revokeAllLeasedUrls = () => {
    try {
      for (const u of urlLeaseRef.current.values()) safeRevoke(u);
    } catch {}
    urlLeaseRef.current = new Map();
  };

  useEffect(() => {
    let cancelled = false;

    async function hydrateCurrentWorksheetBridgeUrls() {
      revokeAllLeasedUrls();

      setConnections((prev) =>
        prev.map((r) => (Number(r.fromSlot) === Number(currentFromSlot) ? { ...r, bridgeUrl: "" } : r))
      );

      const rows = connections.filter((r) => Number(r.fromSlot) === Number(currentFromSlot));
      const hydrated = await Promise.all(
        rows.map(async (r) => {
          if (!r.bridgeStoreKey) return r;
          const blob = await idbGetBlob(r.bridgeStoreKey);
          if (cancelled || !blob) return r;
          const url = URL.createObjectURL(blob);
          urlLeaseRef.current.set(r.key, url);
          return { ...r, bridgeUrl: url };
        })
      );

      if (cancelled) return;

      setConnections((prev) => {
        const map = new Map(hydrated.map((x) => [x.key, x]));
        return prev.map((r) => {
          const h = map.get(r.key);
          if (!h) return r;
          return {
            ...r,
            bridgeFileName: h.bridgeFileName || r.bridgeFileName,
            bridgeStoreKey: h.bridgeStoreKey || r.bridgeStoreKey,
            bridgeUrl: h.bridgeUrl || "",
          };
        });
      });
    }

    hydrateCurrentWorksheetBridgeUrls();

    return () => {
      cancelled = true;
      revokeAllLeasedUrls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentFromSlot]);

  /* ---------------- load catalog (A/B URLs per slot) ---------------- */

  const urlCacheRef = useRef(new Map());

  useEffect(() => {
    if (!projectId) return;

    // Only error when we actually need backend (songs needs latest snapshot + playback URLs)
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

        const project = j?.snapshot?.project || {};
        const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
        const albumTitles = Array.isArray(project?.album?.songTitles) ? project.album.songTitles : [];

        // Newer catalog uses slot-based local model; older snapshot may use locked catalog shapes.
        // We support both:
        // - preferred: project.catalog.songs[] with {slot,title,files:{a,b}}
        // - legacy locked: project.locked.catalog.songs[] with {songNumber,title,versions:{A,B}}
        const lockedSongs =
          Array.isArray(j?.snapshot?.locked?.catalog?.songs) ? j.snapshot.locked.catalog.songs : [];

        const rows = Array.from({ length: SONG_COUNT }).map((_, idx) => {
          const slot = idx + 1;

          const aTitle = albumTitles.find((x) => Number(x.slot) === slot);
          const cSong = catalogSongs.find((x) => Number(x?.slot) === slot);
          const lSong = lockedSongs.find((x) => Number(x?.songNumber) === slot);

          const title =
            String(aTitle?.title || cSong?.title || lSong?.title || "").trim() || `Song ${slot}`;

          // Prefer slot model (files.a/files.b), fallback to locked versions A/B
          const aFileName = String(cSong?.files?.a?.fileName || lSong?.versions?.A?.fileName || "").trim();
          const aS3Key = String(cSong?.files?.a?.s3Key || lSong?.versions?.A?.s3Key || "").trim();
          const bFileName = String(cSong?.files?.b?.fileName || lSong?.versions?.B?.fileName || "").trim();
          const bS3Key = String(cSong?.files?.b?.s3Key || lSong?.versions?.B?.s3Key || "").trim();

          return {
            slot,
            title,
            a: { fileName: aFileName, s3Key: aS3Key, url: "" },
            b: { fileName: bFileName, s3Key: bS3Key, url: "" },
          };
        });

        const withUrls = await Promise.all(
          rows.map(async (s) => {
            const next = { ...s, a: { ...s.a }, b: { ...s.b } };

            if (next.a.s3Key) {
              const cached = urlCacheRef.current.get(next.a.s3Key);
              if (cached) next.a.url = cached;
              else {
                const u = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: next.a.s3Key });
                next.a.url = u || "";
                if (u) urlCacheRef.current.set(next.a.s3Key, u);
              }
            }

            if (next.b.s3Key) {
              const cached = urlCacheRef.current.get(next.b.s3Key);
              if (cached) next.b.url = cached;
              else {
                const u = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key: next.b.s3Key });
                next.b.url = u || "";
                if (u) urlCacheRef.current.set(next.b.s3Key, u);
              }
            }

            return next;
          })
        );

        if (cancelled) return;
        setCatalog(withUrls);
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

  /* ---------------- helpers ---------------- */

  const songTitle = (slot) => catalog.find((s) => Number(s.slot) === Number(slot))?.title || `Song ${slot}`;
  const songAUrl = (slot) => catalog.find((s) => Number(s.slot) === Number(slot))?.a?.url || "";
  const songBUrl = (slot) => catalog.find((s) => Number(s.slot) === Number(slot))?.b?.url || "";

  const currentWorksheetRows = useMemo(() => {
    return connections.filter((r) => Number(r.fromSlot) === Number(currentFromSlot));
  }, [connections, currentFromSlot]);

  useEffect(() => {
    if (Number(activeToSlot) === Number(currentFromSlot)) {
      const fallback = currentFromSlot === 1 ? 2 : 1;
      setActiveToSlot(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFromSlot]);

  const activePair = useMemo(() => {
    const to = Number(activeToSlot);
    const from = Number(currentFromSlot);
    if (!isValidSlot(from) || !isValidSlot(to) || from === to) return "";
    return pairKey(from, to);
  }, [currentFromSlot, activeToSlot]);

  const activeConn = useMemo(
    () => currentWorksheetRows.find((r) => r.key === activePair) || null,
    [currentWorksheetRows, activePair]
  );

  // bridge player state (separate request vs pause)
  const [bridgeRequestPlayKey, setBridgeRequestPlayKey] = useState("");
  const [bridgeForcePauseKey, setBridgeForcePauseKey] = useState("");
  const [bridgeIsPlaying, setBridgeIsPlaying] = useState(false);

  const requestBridgePlay = (fromSlot, toSlot) => {
    const from = Number(fromSlot);
    const to = Number(toSlot);
    if (!isValidSlot(from) || !isValidSlot(to) || from === to) return;
    setBridgeForcePauseKey("");
    setBridgeRequestPlayKey(pairKey(from, to));
  };

  /* ---------------- actions ---------------- */

  const handlePickBridge = async (fromSlot, toSlot, file) => {
    const from = Number(fromSlot);
    const to = Number(toSlot);
    if (!file) return;
    if (!isValidSlot(from) || !isValidSlot(to) || from === to) return;

    const k = pairKey(from, to);
    if (lockMap?.[k]) return;

    const mb = file.size / (1024 * 1024);
    if (file.size > MAX_BRIDGE_BYTES) {
      window.alert(
        `Bridge file is too large.\n\nMax: ${Math.round(MAX_BRIDGE_BYTES / (1024 * 1024))}MB\nFile: ${mb.toFixed(1)}MB`
      );
      return;
    }

    try {
      const storeKey = `bridge:${String(projectId || "no-project")}:${from}->${to}`;

      await idbSetBlob(storeKey, file);

      const prevUrl = urlLeaseRef.current.get(k);
      safeRevoke(prevUrl);

      const blobUrl = URL.createObjectURL(file);
      urlLeaseRef.current.set(k, blobUrl);

      setConnections((prev) =>
        prev.map((r) => {
          if (r.key !== k) return r;
          if (r.locked) return r;
          return { ...r, bridgeFileName: file.name, bridgeStoreKey: storeKey, bridgeUrl: blobUrl };
        })
      );

      setBridgeMap((prev) => ({
        ...(prev || {}),
        [k]: { bridgeFileName: String(file.name || ""), bridgeStoreKey: storeKey },
      }));
    } catch (e) {
      window.alert(`Bridge upload failed:\n\n${e?.message || String(e)}`);
    }
  };

  const toggleLock = (fromSlot, toSlot) => {
    const from = Number(fromSlot);
    const to = Number(toSlot);
    if (!isValidSlot(from) || !isValidSlot(to) || from === to) return;
    const k = pairKey(from, to);
    setLockMap((prev) => ({ ...(prev || {}), [k]: !prev?.[k] }));
  };

  const setChoice = (fromSlot, toSlot, v) => {
    const from = Number(fromSlot);
    const to = Number(toSlot);
    if (!isValidSlot(from) || !isValidSlot(to) || from === to) return;
    const k = pairKey(from, to);
    if (lockMap?.[k]) return;
    setToListenChoice((prev) => ({ ...(prev || {}), [k]: v === "B" ? "B" : "A" }));
  };

  const goPrev = () => setCurrentFromSlot((s) => (s <= 1 ? 1 : s - 1));
  const goNext = () => setCurrentFromSlot((s) => (s >= SONG_COUNT ? SONG_COUNT : s + 1));

  /* ---------------- players sources ---------------- */

  const fromAUrl = songAUrl(currentFromSlot);
  const toChoice = (toListenChoice?.[activePair] || "A").toUpperCase() === "B" ? "B" : "A";
  const toUrl = toChoice === "B" ? songBUrl(activeToSlot) : songAUrl(activeToSlot);
  const bridgeUrl = activeConn?.bridgeUrl || "";

  const showInlineEqForRow = (rowKey) => !!(bridgeIsPlaying && activePair && rowKey === activePair);

  /* ---------------- numbered nav (reused top+bottom) ---------------- */

  const WorksheetNav = ({ compact = false }) => (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        justifyContent: compact ? "flex-start" : "center",
        alignItems: "center",
      }}
    >
      {Array.from({ length: SONG_COUNT }).map((_, i) => {
        const slot = i + 1;
        const done = !!worksheetLockedMap?.[String(slot)];
        const active = slot === currentFromSlot;

        return (
          <button
            key={slot}
            type="button"
            onClick={() => setCurrentFromSlot(slot)}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: active ? "2px solid #111827" : "1px solid #d1d5db",
              background: active ? "rgba(17,24,39,0.06)" : "#fff",
              fontWeight: 900,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minWidth: 40,
              justifyContent: "center",
            }}
            title={done ? "Worksheet Complete (all locked)" : "Worksheet Incomplete"}
          >
            {slot}
            {done ? <span style={{ fontSize: 12 }}>✔</span> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* header */}
      <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 12 }}>
        Project ID: <code>{projectId}</code>
        {token ? (
          <>
            {" "}
            · Link: <code>{token.slice(0, 10)}…</code>
          </>
        ) : null}
      </div>

      {/* Master Save modal */}
      {msStep ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 20,
          }}
          onClick={closeMasterSave}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              padding: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", opacity: 0.75 }}>
              Master Save
            </div>

            {msStep === 1 ? (
              <>
                <div style={{ marginTop: 10, fontSize: 14, fontWeight: 900 }}>Step 1/2</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
                  Rule: at least <strong>{MASTER_SAVE_MIN_SHEETS}/{SONG_COUNT}</strong> worksheets complete.
                  <br />
                  Current: <strong>{savedCount}/{SONG_COUNT}</strong>
                </div>

                <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" onClick={closeMasterSave} style={resetBtn()}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmMasterSaveStep1}
                    disabled={!canMasterSave}
                    style={playBtn(canMasterSave)}
                    title={!canMasterSave ? "Lock more domes to complete more worksheets" : ""}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 10, fontSize: 14, fontWeight: 900 }}>Step 2/2 — Final confirmation</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
                  Proceed with Master Save for Songs?
                </div>

                <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" onClick={closeMasterSave} style={resetBtn()}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmMasterSaveFinal}
                    disabled={masterSaving}
                    style={playBtn(!masterSaving)}
                  >
                    {masterSaving ? "Saving…" : "Yes — Master Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* title row */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>Songs</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Worksheets Complete: <strong>{savedCount}/{SONG_COUNT}</strong>
          </div>

          <button
            type="button"
            onClick={openMasterSave}
            disabled={masterSaving || !canMasterSave}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              fontWeight: 900,
              border: "1px solid #d1d5db",
              background: masterSaving ? "#e5e7eb" : canMasterSave ? "#111827" : "#e5e7eb",
              color: masterSaving ? "#6b7280" : canMasterSave ? "#f9fafb" : "#6b7280",
              cursor: masterSaving || !canMasterSave ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
            title={!canMasterSave ? `Complete at least ${MASTER_SAVE_MIN_SHEETS}/${SONG_COUNT} worksheets (lock all domes)` : ""}
          >
            {masterSaving ? "Master Saving…" : "Master Save"}
          </button>

          {masterSaveMsg ? <div style={{ fontSize: 11, opacity: 0.7 }}>{masterSaveMsg}</div> : null}
        </div>
      </div>

      {loading ? <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Loading…</div> : null}
      {loadErr ? <div style={{ marginTop: 10, ...errorBox() }}>{loadErr}</div> : null}

      {/* Players */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={card()}>
          <div style={sectionTitle()}>Bridge Preview</div>
          <div style={{ marginTop: 10 }}>
            <BridgePreviewPlayer
              label={`Bridge ${currentFromSlot}→${activeToSlot}`}
              url={bridgeUrl}
              requestPlayKey={bridgeRequestPlayKey}
              activeKey={activePair}
              onPlayed={() => setBridgeRequestPlayKey("")}
              onPlayStateChange={setBridgeIsPlaying}
              forcePauseKey={bridgeForcePauseKey}
              playBtn={playBtn}
              resetBtn={resetBtn}
            />
          </div>
        </div>

        <div style={card()}>
          <div style={sectionTitle()}>A + Bridge + To Preview</div>
          <div style={{ marginTop: 10 }}>
            <ABCTimelinePlayer
              label={`Mix ${currentFromSlot}→${activeToSlot}`}
              aFromUrl={fromAUrl}
              bridgeUrl={bridgeUrl}
              toUrl={toUrl}
              playingEqLabel={`${currentFromSlot}→${activeToSlot}`}
              playBtn={playBtn}
              resetBtn={resetBtn}
            />
          </div>
        </div>
      </div>

      {/* Worksheet Card */}
      <div style={{ marginTop: 14, ...card() }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase", opacity: 0.7 }}>
              Worksheet {currentFromSlot} / {SONG_COUNT}
            </div>
            <div style={{ marginTop: 6, fontSize: 16, fontWeight: 950, color: "#0f172a" }}>
              From Song {currentFromSlot} — {songTitle(currentFromSlot)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Progress: <strong>{savedCount}/{SONG_COUNT}</strong>
            </div>

            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                fontWeight: 900,
                border: worksheetLockedMap?.[String(currentFromSlot)] ? "1px solid #a7f3d0" : "1px solid #fecaca",
                background: worksheetLockedMap?.[String(currentFromSlot)] ? "#d1fae5" : "#fee2e2",
                color: worksheetLockedMap?.[String(currentFromSlot)] ? "#065f46" : "#991b1b",
                whiteSpace: "nowrap",
              }}
              title="Derived: complete only when all domes in this worksheet are locked"
            >
              {worksheetLockedMap?.[String(currentFromSlot)] ? "Worksheet Complete (all locked)" : "Worksheet Incomplete"}
            </div>
          </div>
        </div>

        {/* TOP NAV */}
        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={goPrev} style={resetBtn()} disabled={currentFromSlot <= 1}>
            ◀ Prev
          </button>
          <WorksheetNav compact />
          <button type="button" onClick={goNext} style={resetBtn()} disabled={currentFromSlot >= SONG_COUNT}>
            Next ▶
          </button>
        </div>

        <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
          {/* header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1.8fr 1.6fr 120px",
              gap: 10,
              padding: "10px 12px",
              background: "#f8fafc",
              borderBottom: "1px solid #e5e7eb",
              fontSize: 11,
              fontWeight: 900,
              opacity: 0.75,
              textTransform: "uppercase",
              letterSpacing: 0.2,
              alignItems: "center",
            }}
          >
            <div>From</div>
            <div style={{ textAlign: "center" }}>+ Bridge +</div>

            <div style={{ minWidth: 0 }}>
              <div>To</div>
              <div style={{ marginTop: 2, fontSize: 11, fontWeight: 900, opacity: 0.7, letterSpacing: 0, textTransform: "none" }}>
                To Song {activeToSlot} — {songTitle(activeToSlot)}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>Dome</div>
          </div>

          {currentWorksheetRows.map((row, idx) => {
            const from = Number(row.fromSlot);
            const to = Number(row.toSlot);
            const k = row.key;

            const locked = !!lockMap?.[k];
            const choiceRaw = String(toListenChoice?.[k] || "A").toUpperCase();
            const choice = choiceRaw === "B" ? "B" : "A";

            const toA = songAUrl(to);
            const toB = songBUrl(to);
            const listenUrl = choice === "B" ? toB : toA;

            const isActive = Number(activeToSlot) === to;
            const isThisActivePair = activePair === k;

            return (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1.8fr 1.6fr 120px",
                  gap: 10,
                  padding: "12px 12px",
                  borderBottom: idx === currentWorksheetRows.length - 1 ? "none" : "1px solid #e5e7eb",
                  background: isActive ? "rgba(16,185,129,0.06)" : "#fff",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() => setActiveToSlot(to)}
              >
                {/* FROM */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 950, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Song {from} — {songTitle(from)}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={playBtn(!!fromAUrl)}
                      disabled={!fromAUrl}
                      onClick={(e) => {
                        e.stopPropagation();
                        setBridgeForcePauseKey(k);
                        requestBridgePlay(from, to);
                      }}
                      title={!fromAUrl ? "Missing A audio URL for FROM" : "Play Bridge (preview) - use player above"}
                    >
                      Play Bridge
                    </button>
                  </div>
                </div>

                {/* BRIDGE */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                    {row.bridgeFileName ? row.bridgeFileName : "—"}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                    <label
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #d1d5db",
                        background: locked ? "#f3f4f6" : "#fff",
                        color: locked ? "#6b7280" : "#111827",
                        fontWeight: 900,
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                      title={locked ? "Unlock to change bridge" : "Upload bridge audio (stored in browser)"}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Upload
                      <input
                        type="file"
                        accept="audio/*"
                        style={{ display: "none" }}
                        disabled={locked}
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          e.target.value = "";
                          handlePickBridge(from, to, f);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      style={resetBtn()}
                      disabled={!row.bridgeUrl}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!row.bridgeUrl) return;
                        setBridgeForcePauseKey("");
                        requestBridgePlay(from, to);
                      }}
                      title={!row.bridgeUrl ? "No bridge set" : "Request play for this pair"}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {/* TO */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 950, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Song {to} — {songTitle(to)}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (locked) return;
                        setChoice(from, to, "A");
                      }}
                      style={chip(choice === "A", locked)}
                      title={locked ? "Locked" : "Choose A"}
                    >
                      Listen A
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (locked) return;
                        setChoice(from, to, "B");
                      }}
                      style={chip(choice === "B", locked)}
                      title={locked ? "Locked" : "Choose B"}
                    >
                      Listen B
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!listenUrl) return;
                        // We don’t embed an extra audio element here; the ABCTimelinePlayer is the truth.
                        // This button just focuses the active row.
                        setActiveToSlot(to);
                      }}
                      style={resetBtn()}
                      disabled={!listenUrl}
                      title={!listenUrl ? "Missing selected To URL" : "Focus this row (player above uses selection)"}
                    >
                      Use
                    </button>

                    {showInlineEqForRow(k) ? (
                      <span style={{ display: "inline-flex", gap: 2, alignItems: "flex-end", height: 12, marginLeft: 2 }}>
                        <span style={eqBar()} className="sb-eq1" />
                        <span style={eqBar()} className="sb-eq2" />
                        <span style={eqBar()} className="sb-eq3" />
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* DOME */}
                <div style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLock(from, to);
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: locked ? "1px solid #111827" : "1px solid #d1d5db",
                      background: locked ? "#111827" : "#fff",
                      color: locked ? "#fff" : "#111827",
                      fontWeight: 950,
                      cursor: "pointer",
                      width: "100%",
                    }}
                    title={locked ? "Unlock dome" : "Lock dome"}
                  >
                    {locked ? "Locked" : "Lock"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* BOTTOM NAV */}
        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={goPrev} style={resetBtn()} disabled={currentFromSlot <= 1}>
            ◀ Prev
          </button>
          <WorksheetNav compact />
          <button type="button" onClick={goNext} style={resetBtn()} disabled={currentFromSlot >= SONG_COUNT}>
            Next ▶
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- backend helper ---------------- */

async function fetchPlaybackUrl({ apiBase = "", s3Key }) {
  const base = requireApiBase(apiBase);
  const key = String(s3Key || "").trim();
  if (!key) return "";
  const res = await fetch(`${base}/api/playback-url?s3Key=${encodeURIComponent(key)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok !== true) return "";
  return String(json?.url || "");
}

/* ---------------- localStorage helpers ---------------- */

function readTextSafe(key, fallback = "") {
  try {
    const v = localStorage.getItem(String(key));
    return v == null ? fallback : String(v);
  } catch {
    return fallback;
  }
}

function writeTextSafe(key, value) {
  try {
    localStorage.setItem(String(key), String(value));
  } catch {}
}

function readJSONSafe(key, fallback = null) {
  try {
    const raw = localStorage.getItem(String(key));
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSONSafe(key, value) {
  try {
    localStorage.setItem(String(key), JSON.stringify(value ?? null));
  } catch {}
}

/* ---------------- IndexedDB blob store (bridges) ---------------- */

const IDB_DB = "sb-bridges";
const IDB_STORE = "blobs";
const IDB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetBlob(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(String(key));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSetBlob(key, blob) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(blob, String(key));
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- style helpers ---------------- */

function card() {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    background: "#fff",
    padding: 12,
  };
}

function sectionTitle() {
  return { fontSize: 12, fontWeight: 900, textTransform: "uppercase", opacity: 0.7, letterSpacing: 0.2 };
}

function errorBox() {
  return {
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(244,63,94,0.25)",
    background: "rgba(244,63,94,0.08)",
    color: "#9f1239",
    fontWeight: 900,
    whiteSpace: "pre-wrap",
  };
}

function playBtn(enabled = true) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#fff" : "#6b7280",
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    whiteSpace: "nowrap",
  };
}

function resetBtn() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function chip(active, locked) {
  return {
    padding: "8px 10px",
    borderRadius: 999,
    border: active ? "1px solid #111827" : "1px solid #d1d5db",
    background: active ? "#111827" : "#fff",
    color: active ? "#fff" : "#111827",
    fontWeight: 900,
    cursor: locked ? "not-allowed" : "pointer",
    opacity: locked ? 0.6 : 1,
  };
}

function safeRevoke(url) {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {}
}

function ensureEqKeyframes() {
  const id = "sb-eq-keyframes";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes sbEq1 { 0%{transform:scaleY(.25)} 50%{transform:scaleY(1)} 100%{transform:scaleY(.35)} }
    @keyframes sbEq2 { 0%{transform:scaleY(.65)} 50%{transform:scaleY(.25)} 100%{transform:scaleY(1)} }
    @keyframes sbEq3 { 0%{transform:scaleY(.35)} 50%{transform:scaleY(.95)} 100%{transform:scaleY(.25)} }
    .sb-eq1 { animation: sbEq1 700ms infinite ease-in-out; transform-origin: bottom; }
    .sb-eq2 { animation: sbEq2 620ms infinite ease-in-out; transform-origin: bottom; }
    .sb-eq3 { animation: sbEq3 760ms infinite ease-in-out; transform-origin: bottom; }
  `;
  document.head.appendChild(style);
}

function eqBar() {
  return {
    display: "inline-block",
    width: 3,
    borderRadius: 2,
    background: "#111827",
    height: 8,
  };
}
