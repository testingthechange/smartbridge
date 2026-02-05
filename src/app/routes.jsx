// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AdminSend from "./AdminSend.jsx";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

function BuildStamp() {
  return (
    <div style={{ padding: 20, fontFamily: "monospace" }}>
      BUILD-STAMP: 2026-02-05__A
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/send" replace />} />

      {/* TEMP: replace AdminSend with BuildStamp */}
      <Route path="/admin/send" element={<BuildStamp />} />

      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      <Route path="*" element={<Navigate to="/admin/send" replace />} />
    </Routes>
  );
}
