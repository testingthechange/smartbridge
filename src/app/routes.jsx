// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Home from "../pages/Home.jsx";          // or landing page
import Player from "../pages/Player.jsx";
import Account from "../pages/Account.jsx";

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
      {/* ---------- PUBLIC ---------- */}
      <Route path="/" element={<Home />} />
      <Route path="/player/:shareId" element={<Player />} />
      <Route path="/account/:shareId" element={<Account />} />

      {/* ---------- MINISITE ---------- */}
      <Route path="/minisite/:projectId" element={<MiniSiteLayout />}>
        <Route index element={<Catalog />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="album" element={<Album />} />
        <Route path="songs" element={<Songs />} />
        <Route path="meta" element={<Meta />} />
        <Route path="nft-mix" element={<NFTMix />} />
      </Route>

      {/* ---------- ADMIN ---------- */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* ---------- FALLBACK ---------- */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
