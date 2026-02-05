// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";
import AdminSend from "./AdminSend.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Admin */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* Minisite: layout handles :page itself */}
      <Route path="/minisite" element={<Navigate to="/minisite/000000/catalog" replace />} />
      <Route path="/minisite/:projectId" element={<Navigate to="catalog" replace />} />
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      {/* Default */}
      <Route path="*" element={<Navigate to="/minisite/000000/catalog" replace />} />
    </Routes>
  );
}
