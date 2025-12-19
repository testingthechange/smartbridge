// src/components/MasterSaveBar.jsx
import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { useMiniSiteProject } from "../ProjectMiniSiteContext.jsx";
import { publishMiniSite } from "../lib/publishMiniSite.js";

export default function MasterSaveBar() {
  const { projectId: routeProjectId } = useParams();

  const {
    projectId: ctxProjectId,
    runMasterSave,
    masterSaveBusy,
    masterSaveError,
    isMasterSaved,
    masterSavedAt,
    lastMasterSaveKey,
  } = useMiniSiteProject();

  const projectId = ctxProjectId || routeProjectId;

  const [publishBusy, setPublishBusy] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");

  async function onMasterSaveClick() {
    if (!projectId) {
      window.alert("Master Save failed:\nMissing projectId (route/context).");
      return;
    }
    if (masterSaveBusy || isMasterSaved) return;

    // Call context function; if your context doesn't accept args, extra args are ignored.
    try {
      await runMasterSave(projectId);
    } catch (e) {
      window.alert(typeof e?.message === "string" ? e.message : String(e));
    }
  }

  async function onPublish() {
    if (!projectId) {
      window.alert("Publish failed:\nMissing projectId (route/context).");
      return;
    }
    if (!isMasterSaved || !lastMasterSaveKey || publishBusy) return;

    setPublishBusy(true);
    try {
      const out = await publishMiniSite({
        projectId,
        snapshotKey: lastMasterSaveKey,
      });
      setPublishedUrl(out?.publicUrl || "");
      window.alert(out?.publicUrl ? `Published:\n${out.publicUrl}` : "Published.");
    } catch (e) {
      window.alert(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid #e5e5e5", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!projectId || masterSaveBusy || isMasterSaved}
          onClick={onMasterSaveClick}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: !projectId || masterSaveBusy || isMasterSaved ? "not-allowed" : "pointer",
            fontWeight: 700,
            opacity: !projectId ? 0.6 : 1,
          }}
        >
          {masterSaveBusy ? "Saving..." : isMasterSaved ? "Master Saved" : "Master Save"}
        </button>

        <button
          type="button"
          disabled={!projectId || !isMasterSaved || !lastMasterSaveKey || publishBusy}
          onClick={onPublish}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: !projectId || !isMasterSaved || !lastMasterSaveKey || publishBusy ? "not-allowed" : "pointer",
            fontWeight: 700,
            opacity: !projectId || !isMasterSaved || !lastMasterSaveKey ? 0.5 : 1,
          }}
        >
          {publishBusy ? "Publishing..." : "Publish to Storage"}
        </button>

        {isMasterSaved && (
          <span style={{ fontSize: 12 }}>
            ✅ Master Saved at <span style={{ fontFamily: "monospace" }}>{masterSavedAt}</span>
          </span>
        )}
      </div>

      {!projectId ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "crimson" }}>
          Missing projectId (context + route). Check your route like <span style={{ fontFamily: "monospace" }}>/minisite/:projectId</span>.
        </div>
      ) : null}

      {lastMasterSaveKey && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
          Snapshot key: <span style={{ fontFamily: "monospace" }}>{lastMasterSaveKey}</span>
        </div>
      )}

      {publishedUrl && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          Public URL: <span style={{ fontFamily: "monospace" }}>{publishedUrl}</span>
        </div>
      )}

      {masterSaveError && (
        <div style={{ marginTop: 8, color: "crimson", fontSize: 12, whiteSpace: "pre-wrap" }}>
          {masterSaveError}
        </div>
      )}
    </div>
  );
}
