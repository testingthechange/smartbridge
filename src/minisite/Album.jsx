import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { loadProject, saveProject, uploadSongFile } from "./catalog/catalogCore";
import { masterSaveMiniSite } from "./masterSaveMiniSite";

const LOCKS_INIT = {
  meta: false,
  cover: false,
  playlist: false,
};

export default function Album() {
  const { projectId } = useParams();

  const [project, setProject] = useState(null);
  const [locks, setLocks] = useState(LOCKS_INIT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // load project
  useEffect(() => {
    if (!projectId) return;
    const p = loadProject(projectId);
    if (p) {
      setProject(p);
      setLocks(p.album?.locks || LOCKS_INIT);
    }
  }, [projectId]);

  if (!projectId) return <div style={{ padding: 24 }}>Missing projectId</div>;
  if (!project) return <div style={{ padding: 24 }}>Loading Album…</div>;

  /* ---------- derived ---------- */

  const album = project.album || {};
  const meta = album.meta || {};
  const cover = album.cover || {};
  const catalogSongs = project.catalog?.songs || [];

  const playlistOrder =
    Array.isArray(album.playlistOrder) && album.playlistOrder.length
      ? album.playlistOrder
      : catalogSongs.map((s) => s.slot);

  /* ---------- helpers ---------- */

  function persist(next) {
    saveProject(projectId, next);
    setProject(next);
  }

  function setMetaField(key, val) {
    const next = {
      ...project,
      album: {
        ...album,
        meta: { ...meta, [key]: val },
      },
      updatedAt: new Date().toISOString(),
    };
    persist(next);
  }

  function toggleLock(k) {
    const nextLocks = { ...locks, [k]: !locks[k] };
    setLocks(nextLocks);

    const next = {
      ...project,
      album: {
        ...album,
        locks: nextLocks,
      },
    };
    persist(next);
  }

  /* ---------- cover upload ---------- */

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

      const next = {
        ...project,
        album: {
          ...album,
          cover: {
            fileName: file.name,
            s3Key: res.s3Key,
          },
        },
        updatedAt: new Date().toISOString(),
      };

      persist(next);
    } catch (e) {
      setErr(e.message || "Cover upload failed");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- master save ---------- */

  async function masterSaveAlbum() {
    if (busy) return;

    const ok = window.confirm("Master Save Album?");
    if (!ok) return;

    setBusy(true);
    setErr("");

    try {
      const res = await masterSaveMiniSite({
        projectId,
        project,
      });

      const now = new Date().toISOString();

      const next = {
        ...project,
        master: {
          ...(project.master || {}),
          isMasterSaved: true,
          masterSavedAt: now,
          lastSnapshotKey: res.snapshotKey,
        },
        publish: {
          ...(project.publish || {}),
          snapshotKey: res.snapshotKey,
        },
        updatedAt: now,
      };

      persist(next);
      window.alert("Album Master Saved");
    } catch (e) {
      setErr(e.message || "Master Save failed");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div style={{ maxWidth: 1100, padding: 18 }}>
      <h1>Album</h1>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Project {projectId}</div>

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
        <h3>Cover</h3>
        <Lock locked={locks.cover} onToggle={() => toggleLock("cover")} />

        <input
          type="file"
          accept="image/*"
          disabled={locks.cover}
          onChange={(e) => uploadCover(e.target.files?.[0])}
        />

        {cover.s3Key ? (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            s3Key: <code>{cover.s3Key}</code>
          </div>
        ) : null}
      </section>

      {/* PLAYLIST */}
      <section style={card()}>
        <h3>Playlist Order</h3>
        <Lock locked={locks.playlist} onToggle={() => toggleLock("playlist")} />

        <ol>
          {playlistOrder.map((slot) => {
            const s = catalogSongs.find((x) => x.slot === slot);
            return <li key={slot}>{s?.title || `Song ${slot}`}</li>;
          })}
        </ol>
      </section>

      {/* MASTER SAVE */}
      <section style={card()}>
        <button onClick={masterSaveAlbum} disabled={busy}>
          Master Save Album
        </button>

        {project.master?.isMasterSaved ? (
          <div style={{ marginTop: 8, color: "#065f46", fontWeight: 900 }}>
            ✅ Album Master Saved
          </div>
        ) : null}

        {project.master?.lastSnapshotKey ? (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Snapshot: <code>{project.master.lastSnapshotKey}</code>
          </div>
        ) : null}

        {err ? <div style={{ color: "red" }}>{err}</div> : null}
      </section>
    </div>
  );
}

/* ---------- ui helpers ---------- */

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
  };
}

function Lock({ locked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        marginBottom: 8,
        background: locked ? "#fee2e2" : "#e5e7eb",
        border: "none",
        padding: "6px 10px",
        borderRadius: 999,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {locked ? "LOCKED" : "UNLOCKED"}
    </button>
  );
}
