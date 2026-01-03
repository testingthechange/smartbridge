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
  const raw = localStorage.getItem(projectKey(projectId));
  const parsed = raw ? safeParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : null;
}

// IMPORTANT: never write a fresh seed unless nothing exists.
function ensureProject(projectId, seed) {
  const existing = loadProjectLocal(projectId);
  if (existing) return existing;

  const now = nowIso();
  const base = {
    projectId: String(projectId),
    createdAt: now,
    updatedAt: now,
    catalog: { songs: [], masterSave: {} },
    album: { meta: {}, songTitles: [], playlistOrder: [] },
    nftMix: { glueLines: [], masterSave: {} },
    songs: {},
    meta: { songs: [] },
    magic: { token: "", active: false, expiresAt: "", sentAt: "" },
    master: {
      isMasterSaved: false,
      masterSavedAt: "",
      lastSnapshotKey: "",
      producerReturnReceived: false,
      producerReturnReceivedAt: "",
    },
    publish: { lastShareId: "", lastPublicUrl: "", publishedAt: "", manifestKey: "", snapshotKey: "" },
    masterSave: { lastMasterSaveAt: "", sections: {} },
  };

  const seeded = deepMerge(base, seed || {});
  localStorage.setItem(projectKey(projectId), JSON.stringify(seeded));
  return seeded;
}

function writeProjectLocal(projectId, obj) {
  localStorage.setItem(projectKey(projectId), JSON.stringify(obj || {}));
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
  const mergeProject = useCallback((projectId, patch) => {
    if (!projectId) return null;
    const existing = ensureProject(projectId);
    const now = nowIso();

    const merged = deepMerge(existing, patch || {});
    merged.projectId = String(projectId);
    merged.updatedAt = now;

    writeProjectLocal(projectId, merged);

    if (String(projectId) === String(activeProjectId)) {
      setProject(merged);
    }
    return merged;
  }, [activeProjectId]);

  // ✅ Per-section helper: merges only that section
  const setSection = useCallback((projectId, sectionName, sectionPatch) => {
    if (!sectionName) return null;
    return mergeProject(projectId, { [sectionName]: sectionPatch });
  }, [mergeProject]);

  // ✅ Read helper
  const getProject = useCallback((projectId) => {
    if (!projectId) return null;
    return loadProjectLocal(projectId);
  }, []);

  const api = useMemo(() => ({
    activeProjectId,
    setActiveProjectId,
    project,
    mergeProject,
    setSection,
    getProject,
  }), [activeProjectId, project, mergeProject, setSection, getProject]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProjectMiniSite() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectMiniSite must be used within ProjectMiniSiteProvider");
  return v;
}
