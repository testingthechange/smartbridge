// src/ProjectMiniSiteContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const Ctx = createContext(null);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function projectKey(projectId) {
  return `project_${String(projectId || "").trim()}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Deep merge that preserves existing nested objects/arrays unless explicitly replaced.
// - Objects: recursively merged
// - Arrays: replaced (intentional; arrays are usually authoritative lists)
function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return patch.slice();
  if (typeof patch !== "object") return patch;

  const out = { ...(typeof base === "object" && base && !Array.isArray(base) ? base : {}) };

  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    const bv = out[k];

    if (Array.isArray(pv)) out[k] = pv.slice();
    else if (pv && typeof pv === "object") out[k] = deepMerge(bv, pv);
    else out[k] = pv;
  }
  return out;
}

function loadProjectLocal(projectId) {
  if (!projectId) return null;
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

// IMPORTANT: never write a fresh seed unless nothing exists.
function ensureProject(projectId, seed) {
  if (!projectId) return null;

  const existing = loadProjectLocal(projectId);
  if (existing) return existing;

  const now = nowIso();
  const base = {
    projectId: String(projectId),
    createdAt: now,
    updatedAt: now,

    catalog: { songs: [] },
    album: { meta: {}, songTitles: [], playlistOrder: [] },
    nftMix: { glueLines: [] },
    songs: {},
    meta: { songs: [] },

    magic: { token: "", active: false, expiresAt: "", sentAt: "" },

    // Canonical "master pointer" block (what you want to keep in sync)
    master: {
      isMasterSaved: false,
      masterSavedAt: "",
      lastSnapshotKey: "",
      producerReturnReceived: false,
      producerReturnReceivedAt: "",
    },

    publish: {
      lastShareId: "",
      lastPublicUrl: "",
      publishedAt: "",
      manifestKey: "",
      snapshotKey: "",
    },

    // Canonical "sections completion" block
    masterSave: { lastMasterSaveAt: "", sections: {} },
  };

  const seeded = deepMerge(base, seed || {});
  localStorage.setItem(projectKey(projectId), JSON.stringify(seeded));
  return seeded;
}

function writeProjectLocal(projectId, obj) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(obj || {}));
}

function normalizeSnapshotKeyFromResponse(out) {
  // Backend returns { snapshotKey, latestKey }
  // Some older callers might return { s3Key } or { key }
  return (
    String(out?.snapshotKey || "").trim() ||
    String(out?.s3Key || "").trim() ||
    String(out?.key || "").trim() ||
    ""
  );
}

function isTruthySnapshotKey(s) {
  const v = String(s || "").trim();
  return v.startsWith("storage/projects/") && v.includes("/master_save_snapshots/") && v.endsWith(".json");
}

/**
 * Canonical "after master save" patch:
 * - project.master.{isMasterSaved, masterSavedAt, lastSnapshotKey} MUST match latest snapshot
 * - project.masterSave.lastMasterSaveAt updated
 * - project.masterSave.sections updated (keeps any existing section states)
 */
function buildMasterSavePatch({ savedAt, snapshotKey }) {
  const at = String(savedAt || nowIso());

  const masterPatch = {
    isMasterSaved: true,
    masterSavedAt: at,
    ...(snapshotKey ? { lastSnapshotKey: snapshotKey } : {}),
  };

  const sectionsPatch = {
    // Merge-friendly: only touches the keys we include
    catalog: { complete: true, masterSavedAt: at },
    album: { complete: true, masterSavedAt: at },
    songs: { complete: true, masterSavedAt: at },
    meta: { complete: true, masterSavedAt: at },
    // keep nftMix optional by default
    nftMix: { complete: false, masterSavedAt: "" },
  };

  return {
    master: masterPatch,
    masterSave: {
      lastMasterSaveAt: at,
      sections: sectionsPatch,
    },
  };
}

export function ProjectMiniSiteProvider({ children }) {
  const [activeProjectId, setActiveProjectId] = useState("");
  const [project, setProject] = useState(null);

  // Hydrate when projectId changes
  useEffect(() => {
    if (!activeProjectId) return;
    const p = ensureProject(activeProjectId);
    setProject(p);
  }, [activeProjectId]);

  // Focus refresh (coming back from other pages)
  useEffect(() => {
    const onFocus = () => {
      if (!activeProjectId) return;
      const p = loadProjectLocal(activeProjectId);
      if (p) setProject(p);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeProjectId]);

  // ✅ The only safe write: deep-merge into existing project and persist
  const mergeProject = useCallback(
    (projectId, patch) => {
      if (!projectId) return null;
      const existing = ensureProject(projectId);
      if (!existing) return null;

      const now = nowIso();
      const merged = deepMerge(existing, patch || {});
      merged.projectId = String(projectId);
      merged.updatedAt = now;

      writeProjectLocal(projectId, merged);

      if (String(projectId) === String(activeProjectId)) {
        setProject(merged);
      }
      return merged;
    },
    [activeProjectId]
  );

  // ✅ Per-section helper: merges only that section
  const setSection = useCallback(
    (projectId, sectionName, sectionPatch) => {
      if (!projectId || !sectionName) return null;
      return mergeProject(projectId, { [sectionName]: sectionPatch });
    },
    [mergeProject]
  );

  // ✅ Read helper
  const getProject = useCallback((projectId) => {
    if (!projectId) return null;
    return loadProjectLocal(projectId);
  }, []);

  /**
   * ✅ Call this immediately after your backend master-save returns.
   * Example:
   *   const out = await postMasterSave(...)
   *   applyMasterSaveResult(projectId, out)
   */
  const applyMasterSaveResult = useCallback(
    (projectId, out, opts = {}) => {
      if (!projectId) return null;

      const savedAt = String(out?.savedAt || out?.timestamp || opts?.savedAt || nowIso());
      const snapshotKey = normalizeSnapshotKeyFromResponse(out);

      // Only trust snapshotKey if it looks like the real S3 key for snapshot JSON
      const finalSnapshotKey = isTruthySnapshotKey(snapshotKey) ? snapshotKey : "";

      const patch = buildMasterSavePatch({
        savedAt,
        snapshotKey: finalSnapshotKey,
      });

      return mergeProject(projectId, patch);
    },
    [mergeProject]
  );

  const api = useMemo(
    () => ({
      activeProjectId,
      setActiveProjectId,
      project,

      // storage
      mergeProject,
      setSection,
      getProject,

      // master save
      applyMasterSaveResult,
    }),
    [activeProjectId, project, mergeProject, setSection, getProject, applyMasterSaveResult]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProjectMiniSite() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectMiniSite must be used within ProjectMiniSiteProvider");
  return v;
}
