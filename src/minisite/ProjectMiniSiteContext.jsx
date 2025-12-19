// src/ProjectMiniSiteContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { masterSaveMiniSite } from "./lib/masterSaveMiniSite.js";
/**
 * This context is intentionally localStorage-first so you can test immediately.
 * It creates a snapshot object and stores it under a localStorage key:
 *   masterSnapshot_<projectId>_<timestamp>
 *
 * It also writes Master Save status into:
 *   localStorage["project_<projectId>"].masterSave
 *
 * Publish can use snapshotKey (string) from lastMasterSaveKey.
 *
 * IMPORTANT:
 * This provider is mounted at the app shell level, so it CANNOT rely on useParams().
 * Minisite pages must call setActiveProjectId(useParams().projectId) on mount.
 */

const Ctx = createContext(null);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function projectKey(projectId) {
  return `project_${projectId}`;
}

function readProject(projectId) {
  if (!projectId) return null;
  const raw = localStorage.getItem(projectKey(projectId));
  return raw ? safeParse(raw) : null;
}

function writeProject(projectId, nextProject) {
  if (!projectId) return;
  localStorage.setItem(projectKey(projectId), JSON.stringify(nextProject));
  window.dispatchEvent(new CustomEvent("project-updated", { detail: { projectId } }));
}

export function ProjectMiniSiteProvider({ children }) {
  // ✅ single source of truth; minisite pages set this from the route param
  const [explicitProjectId, setExplicitProjectId] = useState("");
  const projectId = String(explicitProjectId || "").trim();

  const [project, setProject] = useState(null);

  // Master Save state exposed to UI
  const [masterSaveBusy, setMasterSaveBusy] = useState(false);
  const [masterSaveError, setMasterSaveError] = useState("");
  const [lastMasterSaveKey, setLastMasterSaveKey] = useState("");
  const [masterSavedAt, setMasterSavedAt] = useState("");

  const isMasterSaved = useMemo(() => {
    return !!(lastMasterSaveKey && masterSavedAt);
  }, [lastMasterSaveKey, masterSavedAt]);

  // ✅ pages call this (Catalog/Album/Meta) with useParams().projectId
  const setActiveProjectId = useCallback((pid) => {
    const next = String(pid || "").trim();
    setExplicitProjectId(next);
  }, []);

  const refreshProject = useCallback(() => {
    if (!projectId) {
      setProject(null);
      setLastMasterSaveKey("");
      setMasterSavedAt("");
      return;
    }

    const p = readProject(projectId);
    setProject(p);

    // also hydrate Master Save info if present
    const ms = p?.masterSave || null;
    const lastKey = typeof ms?.lastMasterSaveKey === "string" ? ms.lastMasterSaveKey : "";
    const lastAt = typeof ms?.lastMasterSavedAt === "string" ? ms.lastMasterSavedAt : "";

    setLastMasterSaveKey(lastKey);
    setMasterSavedAt(lastAt);
  }, [projectId]);

  // initial load + projectId change
  useEffect(() => {
    refreshProject();
  }, [refreshProject]);

  // cross-page updates (your other pages already dispatch "project-updated")
  useEffect(() => {
    const onProjUpdated = (e) => {
      const pid = e?.detail?.projectId;
      if (!pid || pid !== projectId) return;
      refreshProject();
    };

    const onStorage = (e) => {
      // other tabs / windows
      if (!projectId) return;
      if (e?.key === projectKey(projectId)) refreshProject();
    };

    window.addEventListener("project-updated", onProjUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("project-updated", onProjUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [projectId, refreshProject]);

  /**
   * ✅ Local Master Save
   * - two confirmations
   * - creates snapshotKey and stores snapshot into localStorage
   * - writes masterSave status into project_<projectId>
   */
  const runMasterSave = useCallback(
    async (maybeProjectId) => {
      setMasterSaveError("");

      // 1) Resolve projectId from: arg → context
      const pid = String(maybeProjectId || projectId || "").trim();

      if (!pid) {
        const msg = `Missing projectId or project`;
        setMasterSaveError(msg);
        return { ok: false, error: msg };
      }

      // 2) Load project object from localStorage
      const key = `project_${pid}`;
      const raw = localStorage.getItem(key);
      const proj = raw ? safeParse(raw) : null;

      if (!proj) {
        const msg = `Missing projectId or project`;
        setMasterSaveError(msg);
        return { ok: false, error: msg };
      }

      // 3) Required: 2-step confirm (keep this here so masterSaveMiniSite stays pure)
      const first = window.confirm("Are you sure you want to Master Save?");
      if (!first) return { ok: false, error: "Cancelled" };

      const second = window.confirm("Last chance — make sure everything is complete.");
      if (!second) return { ok: false, error: "Cancelled" };

      setMasterSaveBusy(true);
      try {
        // ✅ IMPORTANT: pass both projectId + project
        const out = await masterSaveMiniSite({ projectId: pid, project: proj });

        // Refresh local view after save (masterSaveMiniSite should have written snapshot/project)
        const nextRaw = localStorage.getItem(key);
        const nextProj = nextRaw ? safeParse(nextRaw) : proj;

        setProject(nextProj);

        const ms = nextProj?.masterSave || {};
        setLastMasterSaveKey(ms?.lastMasterSaveKey || out?.snapshotKey || out?.lastMasterSaveKey || "");
        setMasterSavedAt(ms?.lastMasterSavedAt || out?.masterSavedAt || out?.lastMasterSavedAt || "");

        return out?.ok ? out : { ok: true, ...out };
      } catch (e) {
        // Your error is thrown like: Error: {"ok":false,"error":"..."}
        const msg = typeof e?.message === "string" ? e.message : String(e);
        setMasterSaveError(msg);
        return { ok: false, error: msg };
      } finally {
        setMasterSaveBusy(false);
      }
    },
    [projectId]
  );

  /**
   * Optional: if you want to show publish URL inside context later.
   * (MasterSaveBar currently keeps it locally; we keep this ref harmlessly.)
   */
  const setPublishedUrlRef = useRef(() => {});
  const registerPublishedUrlSetter = useCallback((fn) => {
    setPublishedUrlRef.current = typeof fn === "function" ? fn : () => {};
  }, []);

  const value = useMemo(
    () => ({
      projectId,
      project,

      // ✅ add this so minisite pages can set the active projectId
      setActiveProjectId,

      runMasterSave,
      masterSaveBusy,
      masterSaveError,

      isMasterSaved,
      masterSavedAt,
      lastMasterSaveKey,

      refreshProject,

      // optional
      registerPublishedUrlSetter,
    }),
    [
      projectId,
      project,
      setActiveProjectId,
      runMasterSave,
      masterSaveBusy,
      masterSaveError,
      isMasterSaved,
      masterSavedAt,
      lastMasterSaveKey,
      refreshProject,
      registerPublishedUrlSetter,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMiniSiteProject() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useMiniSiteProject must be used within a ProjectMiniSiteProvider");
  }
  return ctx;
}
