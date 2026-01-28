// src/minisite/MiniSiteLayout.jsx
import React from "react";
import { Outlet, useParams, useSearchParams } from "react-router-dom";

import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext.jsx";
import MasterSaveBar from "../components/MasterSaveBar.jsx";

export default function MiniSiteLayout() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();

  const token = (searchParams.get("token") || "").trim();
  const isAdmin = (searchParams.get("admin") || "").trim() === "1";

  // Producer view = token present AND not admin preview
  const isProducerView = !!token && !isAdmin;

  const pid = projectId || "demo";

  return (
    <ProjectMiniSiteProvider projectId={pid}>
      <div style={{ padding: 16 }}>
        {/* Always-safe header: keep only the small producer header requirements.
            IMPORTANT: do NOT reveal internal nav or admin UI in producer view. */}
        {isProducerView ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
            Project: <b>{pid}</b>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
            Project: <b>{pid}</b> • Token:{" "}
            <span style={{ fontFamily: "monospace" }}>{token || "—"}</span>{" "}
            {isAdmin ? <span style={{ marginLeft: 8 }}>(admin)</span> : null}
          </div>
        )}

        {/* Internal-only UI must be hidden from producer magic-link view */}
        {!isProducerView ? <MasterSaveBar /> : null}

        <Outlet />
      </div>
    </ProjectMiniSiteProvider>
  );
}
