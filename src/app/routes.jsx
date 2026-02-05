// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";
import Catalog from "../minisite/Catalog.jsx";
import Album from "../minisite/Album.jsx";
import Songs from "../minisite/Songs.jsx";
import Meta from "../minisite/Meta.jsx";
import NFTMix from "../minisite/NFTMix.jsx";

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
        <Route path="album" element={<Album />} />
        <Route path="songs" element={<Songs />} />
        <Route path="meta" element={<Meta />} />
        <Route path="nft-mix" element={<NFTMix />} />
        <Route path="*" element={<Navigate to="catalog" replace />} />
      </Route>

      {/* Default: send unknown routes to minisite instead of admin */}
      <Route path="/" element={<Navigate to="/minisite/000000/catalog" replace />} />
      <Route path="*" element={<Navigate to="/minisite/000000/catalog" replace />} />
    </Routes>
  );
}
