// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";
import AdminSend from "./AdminSend.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/admin/send" element={<AdminSend />} />
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />
      <Route path="*" element={<Navigate to="/admin/send" replace />} />
    </Routes>
  );
}
