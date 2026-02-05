// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";
import Catalog from "../minisite/Catalog.jsx";
import AdminSend from "./AdminSend.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Admin */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* Minisite */}
      <Route path="/minisite" element={<Navigate to="/minisite/000000/catalog" replace />} />

      <Route path="/minisite/:projectId" element={<MiniSiteLayout />}>
        <Route index element={<Navigate to="catalog" replace />} />
        <Route path="catalog" element={<Catalog />} />

        {/* placeholders until these pages exist in this repo */}
        <Route path="album" element={<Navigate to="../catalog" replace />} />
        <Route path="songs" element={<Navigate to="../catalog" replace />} />
        <Route path="meta" element={<Navigate to="../catalog" replace />} />
        <Route path="nft-mix" element={<Navigate to="../catalog" replace />} />

        <Route path="*" element={<Navigate to="catalog" replace />} />
      </Route>

      {/* Default */}
      <Route path="*" element={<Navigate to="/minisite/000000/catalog" replace />} />
    </Routes>
  );
}
