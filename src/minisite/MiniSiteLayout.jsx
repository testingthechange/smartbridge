// src/minisite/MiniSiteLayout.jsx
import React from "react";
import { Outlet, useParams, useSearchParams } from "react-router-dom";

import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext.jsx";
import MasterSaveBar from "../components/MasterSaveBar.jsx";

export default function MiniSiteLayout() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const pid = projectId || "demo";

  // IMPORTANT:
  // This layout is used by nested routes in App.jsx.
  // So we render <Outlet /> here, not a manual page switch.
  return (
    <ProjectMiniSiteProvider projectId={pid}>
      <div style={{ padding: 16 }}>
        {/* optional small header (can remove if you want) */}
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          Project: <b>{pid}</b> • Token: <span style={{ fontFamily: "monospace" }}>{token}</span>
        </div>

        <MasterSaveBar />
        <Outlet />
      </div>
    </ProjectMiniSiteProvider>
  );
}
