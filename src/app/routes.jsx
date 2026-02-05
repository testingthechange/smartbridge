// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AdminSend from "./AdminSend.jsx";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public root */}
      <Route path="/" element={<AdminSend />} />

      {/* Admin explicit */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* Minisite */}
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      {/* Fallback should NOT point to admin */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
