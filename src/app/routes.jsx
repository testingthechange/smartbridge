// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />
      <Route path="*" element={<Navigate to="/minisite/409074/catalog?token=demo" replace />} />
    </Routes>
  );
}
