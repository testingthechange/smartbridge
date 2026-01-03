// src/minisite/songs/useSongsMasterSave.js
import { useCallback, useMemo, useState } from "react";

/**
 * Hook only. NO JSX in here.
 *
 * Songs.jsx expects:
 *   const { masterSaving, masterSaveMsg, doMasterSave } = useSongsMasterSave(...)
 *
 * This matches Album.jsx Master Save behavior:
 *  1) GET latest snapshot
 *  2) Merge songs section into project
 *  3) POST /api/master-save with { projectId, project }
 */
export function useSongsMasterSave({
  projectId,
  token, // kept for future use; not required by Album save route
  apiBase,
  connections,
  toListenChoice,
  lockMap,
  bridgeMap,
}) {
  const [masterSaving, setMasterSaving] = useState(false);
  const [masterSaveMsg, setMasterSaveMsg] = useState("");

  // Build stable songs section (no blob URLs, no bytes)
  const songsSection = useMemo(() => {
    const safeConnections = Array.isArray(connections) ? connections : [];

    // Strip volatile fields
    const cleanedConnections = safeConnections.map((r) => ({
      key: String(r?.key || ""),
      fromSlot: Number(r?.fromSlot) || 1,
      toSlot: Number(r?.toSlot) || 0,
      locked: !!r?.locked,
      bridgeFileName: String(r?.bridgeFileName || ""),
      bridgeStoreKey: String(r?.bridgeStoreKey || ""),
      // IMPORTANT: do NOT persist bridgeUrl (blob url)
      bridgeUrl: "",
    }));

    return {
      ...(token ? { token: String(token) } : {}),
      savedAt: new Date().toISOString(),
      connections: cleanedConnections,
      toListenChoice:
        toListenChoice && typeof toListenChoice === "object"
          ? toListenChoice
          : {},
      lockMap: lockMap && typeof lockMap === "object" ? lockMap : {},
      bridgeMap: bridgeMap && typeof bridgeMap === "object" ? bridgeMap : {},
    };
  }, [connections, toListenChoice, lockMap, bridgeMap, token]);

  const doMasterSave = useCallback(async () => {
    if (!apiBase) {
      setMasterSaveMsg("Missing VITE_BACKEND_URL in .env.local");
      return false;
    }
    if (!projectId) {
      setMasterSaveMsg("Missing projectId.");
      return false;
    }

    setMasterSaving(true);
    setMasterSaveMsg("Saving…");

    try {
      // 1) Load latest snapshot
      const r1 = await fetch(
        `${apiBase}/api/master-save/latest/${encodeURIComponent(
          String(projectId)
        )}`
      );
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${r1.status}`);

      const currentProject = j1?.snapshot?.project || {};

      // 2) Merge songs section
      const nextProject = {
        ...currentProject,
        songs: {
          ...(currentProject.songs || {}),
          ...songsSection,
        },
      };

      // 3) Save snapshot (same route + payload shape as Album.jsx)
      const r2 = await fetch(`${apiBase}/api/master-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, project: nextProject }),
      });

      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${r2.status}`);

      setMasterSaveMsg("Master Saved ✅");
      return true;
    } catch (e) {
      setMasterSaveMsg(`Master Save failed: ${e?.message || String(e)}`);
      return false;
    } finally {
      setMasterSaving(false);
    }
  }, [apiBase, projectId, songsSection]);

  return { masterSaving, masterSaveMsg, doMasterSave };
}
