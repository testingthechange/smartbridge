import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { loadProject, saveProject } from "./catalog/catalogCore.js";
import { masterSaveMiniSite } from "../lib/masterSaveMiniSite.js";

/**
 * MINIMAL ALBUM — RESET VERSION
 * Purpose:
 * - Prove locks
 * - Prove Master Save
 * - Produce valid snapshotKey for Publish
 */

export default function Album() {
  const { projectId } = useParams();

  const [project, setProject] = useState(null);
  const [locks, setLocks] = useState({
    playlist: false,
    meta: false,
    cover: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const p = loadProject(projectId);
    if (!p) return;

    const next = {
      ...p,
      album: {
        ...(p.album || {}),
        locks: {
          playlist: !!p.album?.locks?.playlist,
          meta: !!p.album?.locks?.meta,
          cover: !!p.album?.locks?.cover,
        },
        junk: p.album?.junk || {
          playlist: "FAKE PLAYLIST DATA",
          meta: "FAKE META DATA",
          cover: "FAKE COVER DATA",
        },
      },
    };

    saveProject(projectId, next);
    setProject(next);
    setLocks(next.album.locks);
  }, [projectId]);

  function toggleLock(key) {
    const nextLocks = { ...locks, [key]: !locks[key] };
    const next = {
      ...project,
      album: {
        ...(project.album || {}),
        locks: nextLocks,
      },
    };
    saveProject(projectId, next);
    setProject(next);
    setLocks(nextLocks);
  }

  async function masterSaveAlbum() {
    if (busy) return;
    setBusy(true);
    setErr("");

    try {
      const current = loadProject(projectId);
      if (!current) throw new Error("No project");

      // write album master marker
      const next = {
        ...current,
        album: {
          ...(current.album || {}),
          masterSave: {
            savedAt: new Date().toISOString(),
            locks,
            junk: current.album?.junk,
          },
        },
      };
      saveProject(projectId, next);

      // POST FULL PROJECT (same as Catalog)
      const res = await masterSaveMiniSite({
        projectId,
        project: next,
      });

      const snapshotKey = String(res?.snapshotKey || "");
      if (!snapshotKey) throw new Error("No snapshotKey returned");

      const final = {
        ...next,
        master: {
          ...(next.master || {}),
          isMasterSaved: true,
          lastSnapshotKey: snapshotKey,
          masterSavedAt: new Date().toISOString(),
        },
        publish: {
          ...(next.publish || {}),
          snapshotKey,
        },
      };

      saveProject(projectId, final);
      setProject(final);
      alert("Album Master Saved");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!project) return <div>Loading Album…</div>;

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Album (Reset)</h1>
      <div>Project {projectId}</div>

      {err && <div style={{ color: "red" }}>{err}</div>}

      {["playlist", "meta", "cover"].map((k) => (
        <div
          key={k}
          style={{
            border: "1px solid #ddd",
            padding: 12,
            marginTop: 12,
          }}
        >
          <strong>{k.toUpperCase()}</strong>
          <div style={{ marginTop: 6 }}>
            Lock: {locks[k] ? "LOCKED" : "UNLOCKED"}
          </div>
          <button onClick={() => toggleLock(k)} style={{ marginTop: 6 }}>
            Toggle Lock
          </button>
        </div>
      ))}

      <div style={{ marginTop: 24 }}>
        <button onClick={masterSaveAlbum} disabled={busy}>
          {busy ? "Saving…" : "Master Save Album"}
        </button>
      </div>
    </div>
  );
}
