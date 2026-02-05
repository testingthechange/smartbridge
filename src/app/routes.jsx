// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AdminSend from "./AdminSend.jsx";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public root */}
      <Route path="/" element={<Navigate to="/admin/send" replace />} />

      {/* Admin */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* Minisite (page param style) */}
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/admin/send" replace />} />
    </Routes>
  );
}
