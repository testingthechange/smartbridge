// src/ProjectMiniSiteContext.jsx
import React, { createContext, useContext, useMemo, useState } from "react";
import { masterSaveMiniSite } from "./lib/masterSaveMiniSite.js";
import { loadProject, saveProject } from "./minisite/projectLocal.js";

const Ctx = createContext(null);

function makeDefaultTracks() {
  return Array.from({ length: 9 }).map((_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return {
      trackId: `t${n}`,
      title: "",
      // mp3: { fileName, s3Key, etag, uploadedAt }
      mp3: null,
    };
  });
}

function makeDefaultSections() {
  return {
    catalog: { status: "draft" },
    album: { status: "draft" },
    nftMix: { status: "draft" },
    songs: { status: "draft" },
    meta: { status: "draft" },
  };
}

/* ---------------- Two-tier validation helpers ---------------- */

function isTwoTierComplete(q) {
  if (!q) return true;

  const t1v = q?.tier1?.value;
  if (t1v === null || typeof t1v === "undefined") return false;

  const t2 = q?.tier2;
  if (t2?.visible) {
    const t2v = t2?.value;
    if (t2v === null || typeof t2v === "undefined" || String(t2v).trim() === "") return false;
  }
  return true;
}

function validateTwoTier(twoTier) {
  if (!twoTier) return { ok: true, message: "" };

  const sectionKeys = ["catalog", "album", "nftMix"];
  for (const sk of sectionKeys) {
    const bucket = twoTier?.[sk];
    if (!bucket) continue;

    for (const [qid, q] of Object.entries(bucket)) {
      if (!isTwoTierComplete(q)) {
        return { ok: false, message: `Two-tier question incomplete: ${sk}.${qid}` };
      }
    }
  }

  const songBuckets = ["songs", "meta"];
  for (const sb of songBuckets) {
    const bySong = twoTier?.[sb];
    if (!bySong) continue;

    for (const [songKey, qMap] of Object.entries(bySong)) {
      if (!qMap) continue;

      for (const [qid, q] of Object.entries(qMap)) {
        if (!isTwoTierComplete(q)) {
          return { ok: false, message: `Two-tier question incomplete: ${sb}[${songKey}].${qid}` };
        }
      }
    }
  }

  return { ok: true, message: "" };
}

function hasAnyTwoTier(twoTier) {
  if (!twoTier) return false;

  const hasSection =
    Object.keys(twoTier?.catalog || {}).length > 0 ||
    Object.keys(twoTier?.album || {}).length > 0 ||
    Object.keys(twoTier?.nftMix || {}).length > 0;

  const hasSongs = Object.keys(twoTier?.songs || {}).length > 0;
  const hasMeta = Object.keys(twoTier?.meta || {}).length > 0;

  return hasSection || hasSongs || hasMeta;
}

/* ---------------- Provider ---------------- */

export function ProjectMiniSiteProvider({ projectId, children }) {
  const [tracks, setTracks] = useState(makeDefaultTracks());
  const [sections, setSections] = useState(makeDefaultSections());

  // Two-tier questions state (pages write here)
  const [twoTier, setTwoTier] = useState({});

  // Master Save UX state
  const [masterSaveBusy, setMasterSaveBusy] = useState(false);
  const [lastMasterSaveKey, setLastMasterSaveKey] = useState("");
  const [lastMasterSaveId, setLastMasterSaveId] = useState("");
  const [masterSaveError, setMasterSaveError] = useState("");

  // Freeze/idle state after successful Master Save
  const [masterSavedAt, setMasterSavedAt] = useState("");
  const isMasterSaved = !!masterSavedAt;

  // Master Save tracking block (mini-site level)
  const [masterSave, setMasterSave] = useState({
    lastMasterSaveAt: "",
    sections: {
      catalog: { complete: false, masterSavedAt: "" },
      album: { complete: false, masterSavedAt: "" },
      nftMix: { complete: false, masterSavedAt: "" },
      songs: { complete: false, masterSavedAt: "" },
      meta: { complete: false, masterSavedAt: "" },
    },
  });

  async function runMasterSave() {
    if (masterSaveBusy || isMasterSaved) return null;

    setMasterSaveError("");

    // Enforce two-tier completeness only if any questions are present
    if (hasAnyTwoTier(twoTier)) {
      const gate = validateTwoTier(twoTier);
      if (!gate.ok) {
        setMasterSaveError(gate.message);
        window.alert(gate.message);
        return null;
      }
    }

    // Two popups always (exact text)
    const ok1 = window.confirm("Are you sure you want to save?");
    if (!ok1) return null;

    const ok2 = window.confirm("Last chance make sure everything is complete.");
    if (!ok2) return null;

    setMasterSaveBusy(true);

    try {
      // 1) Load current local project
      const current = loadProject(projectId) || { projectId: String(projectId) };
      const nowIso = new Date().toISOString();

      // 2) Merge mini-site state into the real project object
      //    IMPORTANT: this is what we want stored in S3 snapshots
      const nextProject = {
        ...current,
        projectId: String(current?.projectId || projectId),
        updatedAt: nowIso,

        // keep existing top-level pages untouched; we only attach/refresh these surfaces
        tracks,
        sections,
        twoTier,

        // keep the app-level tracking block too (matches what you showed in snapshots)
        masterSave: current?.masterSave || current?.masterSave || current?.masterSave,
      };

      // 3) POST full project to backend snapshot route (via your helper)
      //    We pass both styles:
      //    - project (for server.js which expects { projectId, project })
      //    - tracks/sections/twoTier (for older helper versions that still build payload)
      const out = await masterSaveMiniSite({
        projectId,
        project: nextProject,
        tracks,
        sections,
        twoTier,
      });

      // 4) Normalize response keys from backend
      const snapshotKey = String(out?.snapshotKey || out?.s3Key || out?.key || "");
      const latestKey = String(out?.latestKey || "");
      const savedAt = String(out?.savedAt || out?.timestamp || new Date().toISOString());
      const masterSaveId = String(out?.masterSaveId || out?.id || "");

      // 5) Persist keys back into local project (so reloads can find latest snapshotKey)
      const finalProject = {
        ...nextProject,
        updatedAt: savedAt,
        master: {
          ...(nextProject?.master || {}),
          isMasterSaved: true,
          masterSavedAt: savedAt,
          lastSnapshotKey: snapshotKey,
        },
        // keep a publish surface if it exists; don't overwrite it
        publish: {
          ...(nextProject?.publish || {}),
          snapshotKey: nextProject?.publish?.snapshotKey || snapshotKey || "",
        },
      };

      saveProject(projectId, finalProject);

      // 6) Update UI state
      setLastMasterSaveKey(snapshotKey || latestKey);
      setLastMasterSaveId(masterSaveId);

      // Freeze the mini-site
      setMasterSavedAt(savedAt);

      // Update masterSave tracking structure (mini-site UI tracking)
      setMasterSave({
        lastMasterSaveAt: savedAt,
        sections: {
          catalog: { complete: true, masterSavedAt: savedAt },
          album: { complete: true, masterSavedAt: savedAt },
          nftMix: { complete: false, masterSavedAt: "" }, // optional/iterable
          songs: { complete: true, masterSavedAt: savedAt },
          meta: { complete: true, masterSavedAt: savedAt },
        },
      });

      // Final confirmation message (explicit)
      window.alert("Master Save confirmed.\n\nSnapshot written.");

      return out;
    } catch (e) {
      const msg = typeof e?.message === "string" ? e.message : String(e);
      console.error("Master Save failed:", e);
      setMasterSaveError(msg);
      window.alert(`Master Save failed:\n${msg}`);
      return null;
    } finally {
      setMasterSaveBusy(false);
    }
  }

  const value = useMemo(
    () => ({
      projectId,

      // data
      tracks,
      setTracks,
      sections,
      setSections,

      // two-tier
      twoTier,
      setTwoTier,

      // master save
      masterSaveBusy,
      masterSaveError,
      lastMasterSaveKey,
      lastMasterSaveId,
      runMasterSave,

      // freeze/idle
      isMasterSaved,
      masterSavedAt,

      // tracking
      masterSave,
      setMasterSave,
    }),
    [
      projectId,
      tracks,
      sections,
      twoTier,
      masterSaveBusy,
      masterSaveError,
      lastMasterSaveKey,
      lastMasterSaveId,
      isMasterSaved,
      masterSavedAt,
      masterSave,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMiniSiteProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMiniSiteProject must be used inside ProjectMiniSiteProvider");
  return v;
}
