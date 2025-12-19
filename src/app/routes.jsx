// src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Mini-site magic link view */}
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      {/* Redirect /minisite/:projectId -> /minisite/:projectId/catalog (preserve token) */}
      <Route path="/minisite/:projectId" element={<MiniSiteProjectRedirect />} />

      {/* Default */}
      <Route path="*" element={<Navigate to="/minisite/demo/catalog?token=demo" replace />} />
    </Routes>
  );
}

function MiniSiteProjectRedirect() {
  // Preserve ?token=... when redirecting
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "demo";

  // Extract projectId from the URL path: /minisite/:projectId
  // This avoids adding another dependency/import just for useParams here.
  const parts = window.location.pathname.split("/").filter(Boolean);
  const projectId = parts.length >= 2 ? parts[1] : "demo";

  return (
    <Navigate
      to={`/minisite/${encodeURIComponent(projectId)}/catalog?token=${encodeURIComponent(token)}`}
      replace
    />
  );
}
