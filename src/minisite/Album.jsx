import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { loadProject, saveProject, uploadSongFile, fetchPlaybackUrl } from "./catalog/catalogCore";
import { masterSaveMiniSite } from "./masterSaveMiniSite";

const LOCKS_INIT = { meta: false, cover: false, playlist: false };

export default function Album() {
  const { projectId } = useParams();

  const [project, setProject] = useState(null);
  const [locks, setLocks] = useState(LOCKS_INIT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // cover preview (signed url)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");

  // DnD
  const dragFromIdxRef = useRef(null);

  // load project
  useEffect(() => {
    if (!projectId) return;
    const p = loadProject(projectId);
    if (p) {
      setProject(p);
      setLocks(p.album?.locks || LOCKS_INIT);
    }
  }, [projectId]);

  // keep cover preview alive across reloads
  useEffect(() => {
    if (!projectId) return;
    if (!project) return;

    const s3Key = String(project?.album?.cover?.s3Key || "").trim();
    if (!s3Key) {
      setCoverPreviewUrl("");
      return;
    }

    // Prefer persisted previewUrl if present
    const persisted = String(project?.album?.cover?.previewUrl || "").trim();
    if (persisted) {
      setCoverPreviewUrl(persisted);
      return;
    }

    // Otherwise fetch a signed URL (works for images too if backend supports it)
    let cancelled = false;
    (async () => {
      try {
        const url = await fetchPlaybackUrl({ s3Key });
        if (cancelled) return;
        if (url) {
          setCoverPreviewUrl(url);

          // Persist small string only (NOT file bytes)
          const next = {
            ...project,
            album: {
              ...(project.album || {}),
              cover: {
                ...(project.album?.cover || {}),
                previewUrl: url,
              },
            },
          };
          persist(next, { silent: true });
        }
      } catch {
        // leave empty; UI still shows s3Key
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project?.album?.cover?.s3Key]);

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  const album = project.album || {};
  const meta = album.meta || {};
  const cover = album.cover || {};
  const catalogSongs = Array.isArray(project?.catalog?.songs) ? project.catalog.songs : [];

  const playlistOrder = useMemo(() => {
    const existing = Array.isArray(album.playlistOrder) ? album.playlistOrder : [];
    const cleaned = existing.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (cleaned.length) return cleaned;
    return catalogSongs.map((s) => Number(s.slot));
  }, [album.playlistOrder, catalogSongs]);

  function persist(next, { silent = false } = {}) {
    saveProject(projectId, next);
    if (!silent) setProject(next);
  }

  function setMetaField(key, val) {
    if (locks.meta) return;
    const next = {
      ...project,
      album: { ...album, meta: { ...meta, [key]: val } },
      updatedAt: new Date().toISOString(),
    };
    persist(next);
    setProject(next);
  }

  function toggleLock(k) {
    const nextLocks = { ...locks, [k]: !locks[k] };
    setLocks(nextLocks);
    const next = { ...project, album: { ...album, locks: nextLocks } };
    persist(next);
    setProject(next);
  }

  /* ---------- COVER UPLOAD (same flow) ---------- */

  async function uploadCover(file) {
    if (!file) return;
    if (locks.cover) return;

    setBusy(true);
    setErr("");

    try {
      const res = await uploadSongFile({
        projectId,
        slot: "cover",
        versionKey: "album",
        file,
      });

      const s3Key = String(res?.s3Key || "").trim();

      // get signed preview url
      let url = "";
      try {
        if (s3Key) url = await fetchPlaybackUrl({ s3Key });
      } catch {
        url = "";
      }

      const next = {
        ...project,
        album: {
          ...album,
          cover: {
            fileName: file.name,
            s3Key,
            previewUrl: url, // small string only
          },
        },
        updatedAt: new Date().toISOString(),
      };

      persist(next);
      setProject(next);
      setCoverPreviewUrl(url);
    } catch (e) {
      setErr(e?.message || "Cover upload failed");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- PLAYLIST DnD ---------- */

  function onDragStart(idx) {
    if (locks.playlist) return;
    dragFromIdxRef.current = idx;
  }

  function onDragOver(e) {
    if (locks.playlist) return;
    e.preventDefault();
  }

  function onDrop(toIdx) {
    if (locks.playlist) return;

    const fromIdx = dragFromIdxRef.current;
    dragFromIdxRef.current = null;
    if (fromIdx == null || fromIdx === toIdx) return;

    const order = [...playlistOrder];
    const moved = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, moved);

    const next = {
      ...project,
      album: { ...album, playlistOrder: order },
      updatedAt: new Date().toISOString(),
    };

    persist(next);
    setProject(next);
  }

  /* ---------- MASTER SAVE ---------- */

  async function masterSaveAlbum() {
    if (busy) return;

    const ok = window.confirm("Master Save Album?");
    if (!ok) return;

    setBusy(true);
    setErr("");

    try {
      // Ensure project includes latest album state
      const current = loadProject(projectId) || project;

      const res = await masterSaveMiniSite({
        projectId,
        project: current,
      });

      const now = new Date().toISOString();
      const snapshotKey = String(res?.snapshotKey || "");

      const next = {
        ...current,
        master: {
          ...(current.master || {}),
          isMasterSaved: true,
          masterSavedAt: now,
          lastSnapshotKey: snapshotKey,
        },
        publish: {
          ...(current.publish || {}),
          snapshotKey,
        },
        updatedAt: now,
      };

      persist(next);
      setProject(next);

      window.alert("Album Master Saved");
    } catch (e) {
      setErr(e?.message || "Master Save failed");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- UI ---------- */

  return (
    <div style={{ maxWidth: 1100, padding: 18 }}>
      <h1>Album</h1>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Project {projectId}</div>

      {err ? <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 900 }}>{err}</div> : null}

      {/* META */}
      <section style={card()}>
        <h3>Album Meta</h3>
        <Lock locked={locks.meta} onToggle={() => toggleLock("meta")} />

        <input
          placeholder="Album Title"
          value={meta.albumTitle || ""}
          disabled={locks.meta}
          onChange={(e) => setMetaField("albumTitle", e.target.value)}
          style={input()}
        />
        <input
          placeholder="Artist Name"
          value={meta.artistName || ""}
          disabled={locks.meta}
          onChange={(e) => setMetaField("artistName", e.target.value)}
          style={input()}
        />
        <input
          type="date"
          value={meta.releaseDate || ""}
          disabled={locks.meta}
          onChange={(e) => setMetaField("releaseDate", e.target.value)}
          style={input()}
        />
      </section>

      {/* COVER */}
      <section style={card()}>
        <h3>Album Cover</h3>
        <Lock locked={locks.cover} onToggle={() => toggleLock("cover")} />

        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input
            type="file"
            accept="image/*"
            disabled={locks.cover || busy}
            onChange={(e) => uploadCover(e.target.files?.[0] || null)}
          />
          {cover.s3Key ? (
            <div style={{ fontSize: 12 }}>
              s3Key: <code>{cover.s3Key}</code>
            </div>
          ) : null}
        </div>

        {/* ALWAYS show preview area if cover exists */}
        {cover.s3Key ? (
          <div style={{ marginTop: 12 }}>
            {coverPreviewUrl ? (
              <img
                src={coverPreviewUrl}
                alt="album cover"
                style={{ maxWidth: 280, width: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }}
              />
            ) : (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Preview loading (signed URL)… If this never loads, backend may not support signed URLs for images yet.
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* PLAYLIST */}
      <section style={card()}>
        <h3>Playlist Order</h3>
        <Lock locked={locks.playlist} onToggle={() => toggleLock("playlist")} />

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          {locks.playlist ? "LOCKED — drag disabled." : "UNLOCKED — drag rows to reorder."}
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {playlistOrder.map((slot, idx) => {
            const s = catalogSongs.find((x) => Number(x.slot) === Number(slot));
            const title = s?.title || `Song ${slot}`;

            return (
              <div
                key={`${slot}-${idx}`}
                draggable={!locks.playlist}
                onDragStart={() => onDragStart(idx)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(idx)}
                style={{
                  padding: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#fff",
                  cursor: locks.playlist ? "default" : "grab",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                  userSelect: "none",
                }}
                title={locks.playlist ? "Locked" : "Drag to reorder"}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {idx + 1}. {title}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                    slot={slot}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.6 }}>↕</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* MASTER SAVE */}
      <section style={card()}>
        <button onClick={masterSaveAlbum} disabled={busy} style={btn()}>
          {busy ? "Saving…" : "Master Save Album"}
        </button>

        {project.master?.isMasterSaved ? (
          <div style={{ marginTop: 10, color: "#065f46", fontWeight: 900 }}>✅ Album Master Saved</div>
        ) : null}

        {project.master?.lastSnapshotKey ? (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Snapshot: <code>{project.master.lastSnapshotKey}</code>
          </div>
        ) : null}

        {project.publish?.snapshotKey ? (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Publish snapshotKey: <code>{project.publish.snapshotKey}</code>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ---------- UI ---------- */

function card() {
  return {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  };
}

function input() {
  return {
    display: "block",
    width: "100%",
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    outline: "none",
  };
}

function btn() {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#f9fafb",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function Lock({ locked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        marginBottom: 8,
        background: locked ? "#fee2e2" : "#dcfce7",
        border: "1px solid #e5e7eb",
        padding: "6px 10px",
        borderRadius: 999,
        fontWeight: 900,
        cursor: "pointer",
      }}
      title="Toggle lock"
    >
      {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}
