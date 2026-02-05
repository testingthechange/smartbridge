// FILE: src/minisite/Catalog.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams, useParams } from "react-router-dom";

import { useMiniSiteProject } from "../ProjectMiniSiteContext.jsx";
import { loadProject, saveProject } from "./projectLocal.js";

/**
 * Catalog.jsx (cleaned)
 *
 * Goals:
 * - Always render a real "Catalog" page (not a "Songs" header).
 * - Keep state persisted per-project in localStorage via projectLocal.js.
 * - Respect producer vs admin view:
 *    - Producer view = token present AND admin != 1 (cannot add/remove song count).
 *    - Admin view = no token OR admin=1 (can add/remove).
 * - Provide simple audio preview per-row (URL-based) without hard dependencies on other modules.
 * - Keep "Master Save" available (calls context runMasterSave()).
 */

const MAX_SONGS_DEFAULT = 9;

function safeStr(v) {
  return String(v ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSongs(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map((s, idx) => {
      const slot = Number.isFinite(Number(s?.slot)) ? Number(s.slot) : idx + 1;
      return {
        slot,
        title: safeStr(s?.title),
        duration: safeStr(s?.duration),
        aUrl: safeStr(s?.aUrl),
        bUrl: safeStr(s?.bUrl),
      };
    })
    .sort((a, b) => a.slot - b.slot);
}

function makeDefaultSongs(n = MAX_SONGS_DEFAULT) {
  return Array.from({ length: n }).map((_, i) => ({
    slot: i + 1,
    title: "",
    duration: "",
    aUrl: "",
    bUrl: "",
  }));
}

function readProjectCatalog(projectId) {
  const p = loadProject(projectId) || { projectId };
  const catalog = p?.catalog && typeof p.catalog === "object" ? p.catalog : {};
  const songs = normalizeSongs(catalog?.songs);
  return {
    project: p,
    catalog: {
      ...(catalog || {}),
      songs: songs.length ? songs : makeDefaultSongs(MAX_SONGS_DEFAULT),
    },
  };
}

function writeProjectCatalog(projectId, nextCatalog) {
  const current = loadProject(projectId) || { projectId };
  const nextProject = {
    ...current,
    projectId: safeStr(current?.projectId) || safeStr(projectId),
    updatedAt: nowIso(),
    catalog: nextCatalog,
  };
  saveProject(projectId, nextProject);
  return nextProject;
}

function buildSearch(locationSearch, token, isAdmin) {
  const sp = new URLSearchParams(locationSearch || "");
  if (token) sp.set("token", token);
  else sp.delete("token");

  if (isAdmin) sp.set("admin", "1");
  else sp.delete("admin");

  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function Catalog() {
  const { projectId: projectIdParam } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const token = safeStr(searchParams.get("token"));
  const isAdmin = safeStr(searchParams.get("admin")) === "1";
  const isProducerView = Boolean(token) && !isAdmin;

  const projectId = safeStr(projectIdParam);
  const search = useMemo(() => buildSearch(location.search, token, isAdmin), [location.search, token, isAdmin]);

  const { runMasterSave, masterSaveBusy, isMasterSaved, masterSavedAt } = useMiniSiteProject();

  const [songs, setSongs] = useState(() => makeDefaultSongs(MAX_SONGS_DEFAULT));
  const [activeSlot, setActiveSlot] = useState(null);
  const [playingUrl, setPlayingUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const buildStamp = safeStr(import.meta?.env?.VITE_BUILD_STAMP);

  // Load catalog from localStorage on mount and when projectId changes
  useEffect(() => {
    if (!projectId) return;
    const { catalog } = readProjectCatalog(projectId);
    setSongs(normalizeSongs(catalog?.songs));
  }, [projectId]);

  // Persist helper
  function persist(nextSongs) {
    if (!projectId) return;
    const next = normalizeSongs(nextSongs);
    setSongs(next);

    const current = loadProject(projectId) || { projectId };
    const prevCatalog = current?.catalog && typeof current.catalog === "object" ? current.catalog : {};
    writeProjectCatalog(projectId, {
      ...prevCatalog,
      songs: next,
      updatedAt: nowIso(),
    });
  }

  function onChangeSong(slot, patch) {
    persist(
      songs.map((s) => (s.slot === slot ? { ...s, ...patch } : s))
    );
  }

  function addSong() {
    if (isProducerView) return;
    const maxSlot = songs.reduce((m, s) => Math.max(m, s.slot), 0);
    persist([...songs, { slot: maxSlot + 1, title: "", duration: "", aUrl: "", bUrl: "" }]);
  }

  function removeSong() {
    if (isProducerView) return;
    if (songs.length <= 1) return;
    const ok = window.confirm("Remove last song?");
    if (!ok) return;
    persist(songs.slice(0, -1));
  }

  function play(slot, which /* "A" | "B" */) {
    const row = songs.find((s) => s.slot === slot);
    if (!row) return;
    const url = which === "B" ? row.bUrl : row.aUrl;
    if (!safeStr(url)) {
      window.alert(`Missing ${which} URL for slot ${slot}.`);
      return;
    }
    setActiveSlot(slot);
    setPlayingUrl(url);
  }

  async function doMasterSave() {
    if (busy) return;
    setBusy(true);
    try {
      // Keep the Catalog in localStorage up-to-date before master save.
      persist(songs);

      // Delegate to shared provider master save (writes full snapshot).
      await runMasterSave?.();
    } finally {
      setBusy(false);
    }
  }

  const headerNote = isProducerView
    ? "Producer view: edit titles + set URLs."
    : "Admin view: add/remove song count.";

  return (
    <div style={{ padding: "18px 0 40px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 48, letterSpacing: -0.5 }}>Catalog</h1>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>{headerNote}</div>
          {buildStamp ? (
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>
              BUILD-STAMP: <span style={{ fontFamily: "monospace" }}>{buildStamp}</span>
            </div>
          ) : null}
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>
            Link: <span style={{ fontFamily: "monospace" }}>{`/minisite/${encodeURIComponent(projectId)}/catalog${search}`}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={addSong}
            disabled={isProducerView}
            style={{
              padding: "10px 16px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.16)",
              background: isProducerView ? "rgba(0,0,0,0.06)" : "#111827",
              color: isProducerView ? "#111" : "#fff",
              fontWeight: 800,
              cursor: isProducerView ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>

          <button
            onClick={removeSong}
            disabled={isProducerView}
            style={{
              padding: "10px 16px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.18)",
              background: "#fff",
              color: "#111",
              fontWeight: 800,
              cursor: isProducerView ? "not-allowed" : "pointer",
            }}
          >
            Remove
          </button>
        </div>
      </div>

      {/* Player */}
      <div
        style={{
          marginTop: 18,
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 16,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.75 }}>Now Playing</div>
        <div style={{ marginTop: 6, fontWeight: 800, fontSize: 14 }}>
          {activeSlot ? `Slot ${activeSlot}` : "—"}
        </div>

        <div style={{ marginTop: 10 }}>
          <audio
            key={playingUrl || "none"}
            controls
            src={playingUrl || undefined}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>
          Tip: set A/B URLs per slot, then click “Play A/B”.
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          marginTop: 18,
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 16,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "90px 1.4fr 120px 1fr 1fr 160px",
            gap: 0,
            padding: "12px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            fontSize: 12,
            letterSpacing: 0.2,
            fontWeight: 900,
            opacity: 0.8,
          }}
        >
          <div>SLOT</div>
          <div>TITLE</div>
          <div>DURATION</div>
          <div>A URL</div>
          <div>B URL</div>
          <div style={{ textAlign: "right" }}>PREVIEW</div>
        </div>

        {songs.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.7 }}>No songs yet.</div>
        ) : (
          songs.map((s) => (
            <div
              key={s.slot}
              style={{
                display: "grid",
                gridTemplateColumns: "90px 1.4fr 120px 1fr 1fr 160px",
                gap: 10,
                padding: "12px 14px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 900 }}>{s.slot}</div>

              <div>
                <input
                  value={s.title}
                  onChange={(e) => onChangeSong(s.slot, { title: e.target.value })}
                  placeholder={`Song ${s.slot} title`}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.14)",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <input
                  value={s.duration}
                  onChange={(e) => onChangeSong(s.slot, { duration: e.target.value })}
                  placeholder="0:00"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.14)",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <input
                  value={s.aUrl}
                  onChange={(e) => onChangeSong(s.slot, { aUrl: e.target.value })}
                  placeholder="https://... (A)"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.14)",
                    outline: "none",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </div>

              <div>
                <input
                  value={s.bUrl}
                  onChange={(e) => onChangeSong(s.slot, { bUrl: e.target.value })}
                  placeholder="https://... (B)"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.14)",
                    outline: "none",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => play(s.slot, "A")}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(0,0,0,0.16)",
                    background: "#111827",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Play A
                </button>
                <button
                  onClick={() => play(s.slot, "B")}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(0,0,0,0.16)",
                    background: "#fff",
                    color: "#111",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Play B
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Master Save */}
      <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Master Saved:{" "}
          <b>{isMasterSaved ? "YES" : "NO"}</b>
          {masterSavedAt ? (
            <>
              {" "}
              • <span style={{ fontFamily: "monospace" }}>{masterSavedAt}</span>
            </>
          ) : null}
        </div>

        <button
          onClick={doMasterSave}
          disabled={masterSaveBusy || busy || isMasterSaved}
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.16)",
            background: masterSaveBusy || busy || isMasterSaved ? "rgba(0,0,0,0.06)" : "#111827",
            color: masterSaveBusy || busy || isMasterSaved ? "#111" : "#fff",
            fontWeight: 900,
            cursor: masterSaveBusy || busy || isMasterSaved ? "not-allowed" : "pointer",
            minWidth: 220,
          }}
        >
          {isMasterSaved ? "Master Save complete" : masterSaveBusy || busy ? "Saving..." : "Master Save"}
        </button>
      </div>
    </div>
  );
}
