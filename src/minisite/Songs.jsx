// src/minisite/Songs.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSongsMasterSave } from "./songs/useSongsMasterSave";
import { BridgePreviewPlayer, ABCTimelinePlayer } from "./songs/components/Players";
import { loadProject, saveProject } from "./minisite/catalog/catalogCore.js";

const SONG_COUNT = 9;
const MASTER_SAVE_MIN_SHEETS = 8; // allow Master Save once 8/9 (or 9/9) worksheets are complete
const MAX_BRIDGE_BYTES = 50 * 1024 * 1024; // 50MB

export default function Songs() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const API_BASE = String(import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");
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

  /* ---------------- load catalog ---------------- */

  const urlCacheRef = useRef(new Map());

  useEffect(() => {
    if (!projectId) return;
    if (!API_BASE) {
      setLoadErr("Missing VITE_BACKEND_URL in .env.local");
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadErr("");

      try {
        const r = await fetch(`${API_BASE}/api/master-save/latest/${projectId}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (cancelled) return;

        const project = j?.snapshot?.project || {};
        const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
        const albumTitles = Array.isArray(project?.album?.songTitles) ? project.album.songTitles : [];

        const rows = Array.from({ length: SONG_COUNT }).map((_, idx) => {
          const slot = idx + 1;
          const aTitle = albumTitles.find((x) => Number(x.slot) === slot);
          const cSong = catalogSongs.find((x) => Number(x.songNumber) === slot);

          const title = String(aTitle?.title || cSong?.title || "").trim() || `Song ${slot}`;

          const aFileName = String(cSong?.versions?.A?.fileName || "").trim();
          const aS3Key = String(cSong?.versions?.A?.s3Key || "").trim();
          const bFileName = String(cSong?.versions?.B?.fileName || "").trim();
          const bS3Key = String(cSong?.versions?.B?.s3Key || "").trim();

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
                const u = await fetchPlaybackUrl(API_BASE, next.a.s3Key);
                next.a.url = u || "";
                if (u) urlCacheRef.current.set(next.a.s3Key, u);
              }
            }

            if (next.b.s3Key) {
              const cached = urlCacheRef.current.get(next.b.s3Key);
              if (cached) next.b.url = cached;
              else {
                const u = await fetchPlaybackUrl(API_BASE, next.b.s3Key);
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

  const activeConn = useMemo(() => currentWorksheetRows.find((r) => r.key === activePair) || null, [
    currentWorksheetRows,
    activePair,
  ]);

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
            <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", opacity: 0.75 }}>Master Save</div>

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
                  <button type="button" onClick={confirmMasterSaveFinal} disabled={masterSaving} style={playBtn(!masterSaving)}>
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
                }}
                onClick={() => setActiveToSlot(to)}
              >
                {/* FROM */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 950, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Song {from} — {songTitle(from)}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.8 }}>
                    <span style={pill()}>A</span>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>From uses A in preview.</span>
                  </div>
                </div>

                {/* BRIDGE */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", maxWidth: 520 }}>
                    <button
                      type="button"
                      disabled={!row.bridgeUrl}
                      title={row.bridgeUrl ? "Play/Pause bridge in Bridge Preview player" : "Upload bridge first"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!row.bridgeUrl) return;

                        if (isThisActivePair && bridgeIsPlaying) {
                          setBridgeForcePauseKey(k);
                          setBridgeRequestPlayKey("");
                          return;
                        }

                        setActiveToSlot(to);
                        requestBridgePlay(from, to);
                      }}
                      style={circleBtn(!!row.bridgeUrl, isActive)}
                    >
                      {isThisActivePair && bridgeIsPlaying ? "⏸" : "▶"}
                    </button>

                    <label style={uploadBtn(locked)} onClick={(e) => e.stopPropagation()}>
                      Upload
                      <input
                        type="file"
                        accept="audio/*"
                        disabled={locked}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          handlePickBridge(from, to, f);
                          e.target.value = "";
                        }}
                      />
                    </label>

                    <div style={{ minWidth: 0, flex: 1, fontSize: 12, opacity: 0.75, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        {row.bridgeFileName ? <code style={{ wordBreak: "break-word" }}>{row.bridgeFileName}</code> : "—"}
                        {locked ? <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 900, opacity: 0.6 }}>LOCKED</span> : null}
                      </div>

                      {showInlineEqForRow(k) ? <MiniEqPulse /> : null}
                    </div>
                  </div>
                </div>

                {/* TO */}
                <div style={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ fontSize: 13, fontWeight: 950, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Song {to} — {songTitle(to)}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={radioPill(choice === "A", !!toA && !locked)} title={toA ? "Use A" : "Missing A file"}>
                      <input
                        type="radio"
                        name={`to-${k}`}
                        checked={choice === "A"}
                        onChange={() => setChoice(from, to, "A")}
                        disabled={!toA || locked}
                        style={{ marginRight: 6 }}
                      />
                      Listen to A
                    </label>

                    <label style={radioPill(choice === "B", !!toB && !locked)} title={toB ? "Use B" : "Missing B file"}>
                      <input
                        type="radio"
                        name={`to-${k}`}
                        checked={choice === "B"}
                        onChange={() => setChoice(from, to, "B")}
                        disabled={!toB || locked}
                        style={{ marginRight: 6 }}
                      />
                      Listen to B
                    </label>

                    <MiniInlinePlayer url={listenUrl} disabled={!listenUrl} label={`To ${choice}`} />
                  </div>
                </div>

                {/* DOME LOCK */}
                <div style={{ justifySelf: "end" }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => toggleLock(from, to)} style={lockBtn(locked)}>
                    {locked ? "Locked" : "Unlock"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* BOTTOM NAV */}
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={goPrev} style={resetBtn()} disabled={currentFromSlot <= 1}>
            ◀ Prev
          </button>
          <WorksheetNav />
          <button type="button" onClick={goNext} style={resetBtn()} disabled={currentFromSlot >= SONG_COUNT}>
            Next ▶
          </button>
        </div>
      </div>
    </div>
  );
} // ✅ closes Songs() cleanly

/* ---------------- tiny inline To preview ---------------- */

function MiniInlinePlayer({ url, disabled, label }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
  }, [url]);

  const toggle = async () => {
    if (disabled) return;
    const el = audioRef.current;
    if (!el) return;

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await el.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={toggle} disabled={disabled} style={tinyBtn(!disabled)} title={label}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <audio ref={audioRef} src={url || undefined} onEnded={() => setIsPlaying(false)} />
    </div>
  );
}

function MiniEqPulse() {
  return (
    <div
      title="Playing"
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 999,
        border: "1px solid rgba(16,185,129,0.35)",
        background: "rgba(16,185,129,0.08)",
      }}
    >
      <span style={eqBar(0)} />
      <span style={eqBar(120)} />
      <span style={eqBar(240)} />
    </div>
  );
}

function eqBar(delayMs) {
  return {
    width: 4,
    height: 12,
    borderRadius: 3,
    background: "rgba(16,185,129,0.95)",
    display: "inline-block",
    animation: `sbEqPulse 0.75s ease-in-out ${delayMs}ms infinite`,
  };
}

function ensureEqKeyframes() {
  if (typeof document === "undefined") return;
  const id = "sb-eq-keyframes";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
@keyframes sbEqPulse {
  0% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1.0); opacity: 1.0; }
  100% { transform: scaleY(0.45); opacity: 0.65; }
}
`;
  document.head.appendChild(style);
}

/* ---------------- API ---------------- */

async function fetchPlaybackUrl(API_BASE, s3Key) {
  try {
    const qs = new URLSearchParams({ s3Key });
    const r = await fetch(`${API_BASE}/api/playback-url?${qs.toString()}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) return "";
    return String(j.url || "");
  } catch {
    return "";
  }
}

/* ---------------- storage + helpers ---------------- */

function readJSONSafe(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSONSafe(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
}
function readTextSafe(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === undefined ? fallback : String(v);
  } catch {
    return fallback;
  }
}
function writeTextSafe(key, val) {
  try {
    localStorage.setItem(key, String(val ?? ""));
  } catch {}
}

function safeRevoke(url) {
  if (!url) return;
  if (typeof url === "string" && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}

/**
 * Minimal IndexedDB blob store
 * DB: "sb_assets"  Store: "files"
 */
function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("sb_assets", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    } catch (e) {
      reject(e);
    }
  });
}

async function idbSetBlob(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      store.put(blob, key);
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve(true);
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {}
        reject(tx.error || new Error("indexedDB write failed"));
      };
    } catch (e) {
      try {
        db.close();
      } catch {}
      reject(e);
    }
  });
}

async function idbGetBlob(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const req = store.get(key);
      req.onsuccess = () => {
        try {
          db.close();
        } catch {}
        resolve(req.result || null);
      };
      req.onerror = () => {
        try {
          db.close();
        } catch {}
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve(null);
    }
  });
}

/* ---------------- styles ---------------- */

function card() {
  return { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 };
}

function errorBox() {
  return {
    fontSize: 12,
    color: "#991b1b",
    background: "#fee2e2",
    border: "1px solid #fecaca",
    padding: 10,
    borderRadius: 12,
    whiteSpace: "pre-wrap",
  };
}

function sectionTitle() {
  return { fontSize: 12, fontWeight: 900, letterSpacing: 0.2, textTransform: "uppercase" };
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

function playBtn(enabled) {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    width: 110,
  };
}

function resetBtn() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  };
}

function tinyBtn(enabled) {
  return {
    padding: "6px 8px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#6b7280",
    fontSize: 11,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

function pill() {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "4px 10px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.85,
  };
}

function radioPill(active, enabled) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: active ? "1px solid rgba(15,23,42,0.55)" : "1px solid #e5e7eb",
    background: !enabled ? "#f3f4f6" : active ? "rgba(15,23,42,0.05)" : "#fff",
    color: !enabled ? "#9ca3af" : "#111827",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.7,
    userSelect: "none",
  };
}

function circleBtn(enabled, activeRow) {
  return {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: activeRow ? "2px solid rgba(16,185,129,0.55)" : "1px solid #d1d5db",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "#f9fafb" : "#9ca3af",
    fontSize: 12,
    fontWeight: 900,
    cursor: enabled ? "pointer" : "not-allowed",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  };
}
