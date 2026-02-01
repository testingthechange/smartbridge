// FILE: src/minisite/Catalog.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import {
  ensureProject,
  loadProject,
  saveProject,
  setSection,
  fmtTime,
  fetchPlaybackUrl,
  uploadSongFile,
  getApiBase,
} from "./catalogCore.js";

import { masterSaveMiniSite } from "./masterSaveMiniSite.js";

/**
 * Rules (per your SOP):
 * - Producer view (token present): can edit titles + upload files + play in top player + Master Save.
 * - Admin view (no token): can Add/Remove songs (controls song count). No title editing.
 * - Persist everything to localStorage project_{projectId}. NO blob URLs persisted.
 *
 * Alignment fix:
 * - Header + rows use the SAME CSS grid template (no flex).
 * - Title column uses minmax + minWidth:0 so long titles don't push columns.
 * - Play columns are fixed widths, centered.
 */

export default function Catalog() {
  const { projectId } = useParams();
  const location = useLocation();
  const sp = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);

  const token = String(sp.get("token") || "").trim();
  const isAdmin = String(sp.get("admin") || "").trim() === "1";
  const isProducerView = Boolean(token) && !isAdmin;

  const pid = String(projectId || "").trim();

  const API_BASE = useMemo(() => getApiBase(), []);
  const [project, setProject] = useState(() => (pid ? loadProject(pid) : null));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  // player
  const audioRef = useRef(null);
  const [now, setNow] = useState({ slot: null, versionKey: "", title: "", url: "" });
  const [isPlaying, setIsPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);

  // master save
  const [msBusy, setMsBusy] = useState(false);

  // init/load
  useEffect(() => {
    if (!pid) return;
    const p = loadProject(pid) || ensureProject(pid);
    setProject(p);
  }, [pid]);

  // audio events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDur = () => setDur(Number.isFinite(a.duration) ? a.duration : 0);
    const onTime = () => setTime(a.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);

    return () => {
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  const songs = useMemo(() => {
    const arr = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];
    return arr
      .map((s, idx) => {
        const slot = Number.isFinite(Number(s?.slot)) ? Number(s.slot) : idx + 1;
        return {
          ...s,
          slot,
          title: String(s?.title || "").trim(),
          files: s?.files && typeof s.files === "object" ? s.files : {},
        };
      })
      .sort((a, b) => Number(a.slot) - Number(b.slot));
  }, [project]);

  function reread() {
    return loadProject(pid) || project;
  }

  function persist(next) {
    saveProject(pid, next);
    setProject(next);
  }

  // Admin-only: add one song slot to end (sequential)
  function adminAddSong() {
    if (isProducerView) return;

    const current = reread() || ensureProject(pid);
    const curSongs = Array.isArray(current?.catalog?.songs) ? current.catalog.songs : [];

    const nextSlot = curSongs.length + 1;
    const nextSongs = [
      ...curSongs,
      {
        slot: nextSlot,
        title: "",
        createdAt: new Date().toISOString(),
        source: "admin",
        files: {
          album: { fileName: "", s3Key: "", playbackUrl: "" },
          a: { fileName: "", s3Key: "", playbackUrl: "" },
          b: { fileName: "", s3Key: "", playbackUrl: "" },
        },
      },
    ];

    const next = setSection(pid, "catalog", { ...(current.catalog || {}), songs: nextSongs }, { returnProject: true });
    persist(next);
  }

  // Admin-only: remove last song (sequential)
  function adminRemoveSong() {
    if (isProducerView) return;

    const current = reread() || ensureProject(pid);
    const curSongs = Array.isArray(current?.catalog?.songs) ? current.catalog.songs : [];
    if (!curSongs.length) return;

    const nextSongs = curSongs.slice(0, -1).map((s, idx) => ({ ...s, slot: idx + 1 }));
    const next = setSection(pid, "catalog", { ...(current.catalog || {}), songs: nextSongs }, { returnProject: true });
    persist(next);
  }

  // Producer: edit title
  function setTitle(slot, value) {
    if (!isProducerView) return;

    const current = reread();
    if (!current) return;

    const curSongs = Array.isArray(current?.catalog?.songs) ? current.catalog.songs : [];
    const nextSongs = curSongs.map((s) => {
      if (Number(s?.slot) !== Number(slot)) return s;
      return {
        ...s,
        slot: Number(slot),
        title: String(value ?? ""),
        updatedAt: new Date().toISOString(),
        source: "catalog",
      };
    });

    const next = setSection(pid, "catalog", { ...(current.catalog || {}), songs: nextSongs }, { returnProject: true });
    persist(next);
  }

  // Producer: upload file for a slot/version (album|a|b)
  async function onUpload(slot, versionKey, file) {
    if (!isProducerView) return;
    if (!file) return;

    setErr("");
    setBusy(`Uploading ${versionKey.toUpperCase()}…`);

    try {
      const up = await uploadSongFile({
        apiBase: API_BASE,
        projectId: pid,
        slot: String(slot),
        versionKey,
        file,
      });

      const s3Key = String(up?.s3Key || "").trim();
      let signedUrl = "";
      if (s3Key) {
        try {
          signedUrl = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
        } catch {
          signedUrl = "";
        }
      }

      const current = reread();
      if (!current) return;

      const curSongs = Array.isArray(current?.catalog?.songs) ? current.catalog.songs : [];
      const nextSongs = curSongs.map((s) => {
        if (Number(s?.slot) !== Number(slot)) return s;

        const prevFiles = s?.files && typeof s.files === "object" ? s.files : {};
        const prevBucket =
          prevFiles?.[versionKey] && typeof prevFiles[versionKey] === "object" ? prevFiles[versionKey] : {};

        return {
          ...s,
          slot: Number(slot),
          files: {
            ...prevFiles,
            [versionKey]: {
              ...prevBucket,
              fileName: String(file?.name || ""),
              s3Key,
              // Signed URLs may expire; we persist anyway for “immediate play” convenience.
              // If missing/expired, play will re-fetch from s3Key.
              playbackUrl: signedUrl || String(prevBucket?.playbackUrl || ""),
            },
          },
          updatedAt: new Date().toISOString(),
        };
      });

      const next = setSection(pid, "catalog", { ...(current.catalog || {}), songs: nextSongs }, { returnProject: true });
      persist(next);

      // If user just uploaded the currently playing track/version, refresh url
      if (now?.slot === Number(slot) && now?.versionKey === versionKey && s3Key) {
        const url = signedUrl || (await fetchPlaybackUrl({ apiBase: API_BASE, s3Key }));
        startPlay({ slot: Number(slot), versionKey, title: findTitle(nextSongs, slot), url });
      }

      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(e?.message || "Upload failed");
    }
  }

  function findTitle(songList, slot) {
    const s = (songList || []).find((x) => Number(x?.slot) === Number(slot));
    return String(s?.title || "").trim() || `Song ${slot}`;
  }

  async function play(slot, versionKey) {
    setErr("");

    const current = reread();
    const curSongs = Array.isArray(current?.catalog?.songs) ? current.catalog.songs : [];

    const s = curSongs.find((x) => Number(x?.slot) === Number(slot));
    const title = String(s?.title || "").trim() || `Song ${slot}`;

    const bucket = s?.files?.[versionKey] || {};
    const s3Key = String(bucket?.s3Key || "").trim();
    const storedUrl = String(bucket?.playbackUrl || "").trim();

    if (!s3Key && !storedUrl) {
      setErr("No file uploaded for this version.");
      return;
    }

    let url = storedUrl;
    if (!url && s3Key) {
      try {
        url = await fetchPlaybackUrl({ apiBase: API_BASE, s3Key });
      } catch {
        url = "";
      }
    }

    if (!url) {
      setErr("Could not fetch playback URL.");
      return;
    }

    startPlay({ slot: Number(slot), versionKey, title, url });
  }

  function startPlay({ slot, versionKey, title, url }) {
    const a = audioRef.current;
    if (!a) return;

    setNow({ slot, versionKey, title, url });

    try {
      a.pause();
      a.currentTime = 0;
      a.src = url;
      a.load();
      a.play().catch(() => {});
    } catch {
      // ignore
    }
  }

  function togglePlayPause() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function pct() {
    if (!dur) return 0;
    return Math.max(0, Math.min(100, Math.round((time / dur) * 100)));
  }

  async function doMasterSave() {
    if (msBusy) return;

    const first = window.confirm("Master Save Catalog?\n\nThis writes the full local project snapshot.");
    if (!first) return;
    const second = window.confirm("Last chance.\n\nDouble-check everything.");
    if (!second) return;

    setMsBusy(true);
    setErr("");

    try {
      const current = reread();
      if (!current) throw new Error("No project loaded.");

      const res = await masterSaveMiniSite({ projectId: pid, project: current });
      const snapshotKey = String(res?.snapshotKey || "").trim();

      const savedAt = new Date().toISOString();
      const next = {
        ...current,
        master: {
          ...(current.master || {}),
          isMasterSaved: true,
          masterSavedAt: savedAt,
          lastSnapshotKey: snapshotKey,
        },
        publish: {
          ...(current.publish || {}),
          snapshotKey,
        },
        updatedAt: savedAt,
      };

      persist(next);
      window.alert("Catalog Master Save confirmed.");
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setMsBusy(false);
    }
  }

  if (!pid) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading…</div>;

  const headerNote = isProducerView ? "Producer view: edit titles + upload files." : "Admin view: add/remove song count.";

  return (
    <div style={{ padding: "16px 0" }}>
      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 950 }}>Songs</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{headerNote}</div>
        </div>

        {/* Admin controls only */}
        {!isProducerView ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" onClick={adminAddSong} style={styles.primaryBtn}>
              Add
            </button>
            <button type="button" onClick={adminRemoveSong} style={styles.darkBtn}>
              Remove
            </button>
          </div>
        ) : null}
      </div>

      {/* Player (top, sticky/frozen panel) */}
      <div style={styles.playerWrap}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Now Playing</div>
            <div style={{ fontFamily: styles.mono, fontWeight: 900, marginTop: 4 }}>
              {now?.slot ? `#${now.slot} · ${now.title} · ${String(now.versionKey || "").toUpperCase()}` : "—"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" onClick={togglePlayPause} style={styles.primaryBtn} disabled={!now?.url}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.85 }}>
              {fmtTime(time)} / {fmtTime(dur)} · {pct()}%
            </div>
          </div>
        </div>

        <audio ref={audioRef} />

        <input
          type="range"
          min={0}
          max={Math.max(0, Math.floor(dur || 0))}
          value={Math.floor(time || 0)}
          onChange={(e) => {
            const a = audioRef.current;
            if (a) a.currentTime = Number(e.target.value || 0);
          }}
          style={{ width: "100%", marginTop: 10 }}
        />
      </div>

      {busy ? <div style={{ marginTop: 10, fontWeight: 900 }}>{busy}</div> : null}
      {err ? <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 900 }}>{err}</div> : null}

      {/* Table */}
      <div style={styles.tableOuter}>
        <div style={styles.tableInner}>
          <div style={styles.gridHeader}>
            <div style={styles.hcell}>SLOT</div>
            <div style={styles.hcell}>TITLE</div>
            <div style={{ ...styles.hcell, textAlign: "center" }}>ALBUM</div>
            <div style={{ ...styles.hcell, textAlign: "center" }}>A</div>
            <div style={{ ...styles.hcell, textAlign: "center" }}>B</div>
          </div>

          {songs.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.7 }}>No songs yet.</div>
          ) : (
            songs.map((s) => {
              const slot = Number(s?.slot) || 0;
              const album = s?.files?.album || {};
              const a = s?.files?.a || {};
              const b = s?.files?.b || {};

              const playing = now?.slot === slot ? String(now?.versionKey || "") : "";

              return (
                <div key={`slot-${slot}`} style={styles.gridRow}>
                  <div style={styles.slotCell}>{slot}</div>

                  <div style={styles.titleCell}>
                    {isProducerView ? (
                      <input
                        value={String(s?.title || "")}
                        onChange={(e) => setTitle(slot, e.target.value)}
                        placeholder="Song title"
                        style={styles.titleInput}
                      />
                    ) : (
                      <div style={styles.titleText}>{String(s?.title || "").trim() || "—"}</div>
                    )}
                  </div>

                  {/* Album */}
                  <div style={styles.playCell}>
                    <div style={styles.colInner}>
                      <button
                        type="button"
                        onClick={() => play(slot, "album")}
                        disabled={!album?.s3Key && !album?.playbackUrl}
                        style={playing === "album" ? styles.playBtnActive : styles.playBtn}
                      >
                        Play
                      </button>

                      {isProducerView ? (
                        <>
                          <label style={styles.uploadLabel}>
                            Upload
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => onUpload(slot, "album", e.target.files?.[0] || null)}
                              style={styles.fileInput}
                            />
                          </label>
                          {album?.fileName ? <div style={styles.fileName}>{album.fileName}</div> : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* A */}
                  <div style={styles.playCell}>
                    <div style={styles.colInner}>
                      <button
                        type="button"
                        onClick={() => play(slot, "a")}
                        disabled={!a?.s3Key && !a?.playbackUrl}
                        style={playing === "a" ? styles.playBtnActive : styles.playBtn}
                      >
                        Play
                      </button>

                      {isProducerView ? (
                        <>
                          <label style={styles.uploadLabel}>
                            Upload
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => onUpload(slot, "a", e.target.files?.[0] || null)}
                              style={styles.fileInput}
                            />
                          </label>
                          {a?.fileName ? <div style={styles.fileName}>{a.fileName}</div> : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* B */}
                  <div style={styles.playCell}>
                    <div style={styles.colInner}>
                      <button
                        type="button"
                        onClick={() => play(slot, "b")}
                        disabled={!b?.s3Key && !b?.playbackUrl}
                        style={playing === "b" ? styles.playBtnActive : styles.playBtn}
                      >
                        Play
                      </button>

                      {isProducerView ? (
                        <>
                          <label style={styles.uploadLabel}>
                            Upload
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => onUpload(slot, "b", e.target.files?.[0] || null)}
                              style={styles.fileInput}
                            />
                          </label>
                          {b?.fileName ? <div style={styles.fileName}>{b.fileName}</div> : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Master Save (producer only) */}
      {isProducerView ? (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: styles.mono, fontSize: 12, opacity: 0.75 }}>
            {project?.master?.isMasterSaved ? "✅ READY" : "—"}{" "}
            {project?.master?.lastSnapshotKey ? `master.lastSnapshotKey=${project.master.lastSnapshotKey}` : ""}
          </div>

          <button type="button" onClick={doMasterSave} disabled={msBusy} style={msBusy ? styles.primaryBtnDisabled : styles.primaryBtn}>
            Master Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

const GRID_COLS = "80px minmax(260px, 1fr) 240px 240px 240px";

const styles = {
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",

  playerWrap: {
    marginTop: 14,
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    position: "sticky",
    top: 72,
    zIndex: 5,
  },

  // table outer allows horizontal scroll on narrow screens without breaking alignment
  tableOuter: {
    marginTop: 16,
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 14,
    overflowX: "auto",
    background: "#fff",
  },

  tableInner: {
    minWidth: 1040, // keeps grid from collapsing; enables scroll instead
  },

  gridHeader: {
    display: "grid",
    gridTemplateColumns: GRID_COLS,
    alignItems: "center",
    background: "#fafafa",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
  },

  hcell: {
    padding: "12px 12px",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.2,
    opacity: 0.75,
  },

  gridRow: {
    display: "grid",
    gridTemplateColumns: GRID_COLS,
    alignItems: "stretch",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
  },

  slotCell: {
    padding: "12px 12px",
    display: "flex",
    alignItems: "center",
    fontWeight: 950,
    fontSize: 18,
  },

  titleCell: {
    padding: "12px 12px",
    display: "flex",
    alignItems: "center",
    minWidth: 0, // IMPORTANT: prevents title from forcing grid wider (alignment drift)
  },

  titleText: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 13,
    fontWeight: 900,
    opacity: 0.8,
    minWidth: 0,
    wordBreak: "break-word",
  },

  playCell: {
    padding: "12px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  colInner: {
    width: "100%",
    display: "grid",
    gap: 8,
    justifyItems: "center",
    alignItems: "start",
  },

  titleInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
    minWidth: 0,
  },

  playBtn: {
    width: "100%",
    maxWidth: 200,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.22)",
    background: "#fff",
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
  },

  playBtnActive: {
    width: "100%",
    maxWidth: 200,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
  },

  uploadLabel: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "#fff",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    userSelect: "none",
  },

  fileInput: {
    display: "none",
  },

  fileName: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 12,
    opacity: 0.75,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 220,
    justifySelf: "center",
    textAlign: "center",
  },

  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },

  darkBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.22)",
    background: "#fff",
    color: "#111827",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },

  primaryBtnDisabled: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    fontSize: 13,
    fontWeight: 950,
    cursor: "not-allowed",
  },
};
