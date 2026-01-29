// src/app/App.jsx
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";

// UI
import SideNav from "../components/SideNav.jsx";

// Pages
import Login from "../pages/Login.jsx";
import Producer from "../pages/Producer.jsx";
import Projects from "../pages/Projects.jsx";
import Project from "../pages/Project.jsx";

// Tools / Export
import ExportTools from "../pages/ExportTools.jsx";

// Optional (keep ONLY if file exists)
import Admin from "../pages/Admin.jsx";

// Mini-site pages
import Catalog from "../minisite/Catalog.jsx";
import Album from "../minisite/Album.jsx";
import Meta from "../minisite/Meta.jsx";
import NftMix from "../minisite/NFTMix.jsx"; // match filename casing
import Songs from "../minisite/Songs.jsx";

function AppShell() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fafafa" }}>
      <SideNav />
      <main style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}

/**
 * TEST STEP:
 * Bypass ProjectMiniSiteProvider entirely to confirm it is not breaking minisite rendering.
 * (If minisite starts showing content after this change, the provider is the culprit.)
 */
function MiniSiteProviderShell() {
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Core */}
        <Route path="/login" element={<Login />} />

        {/* Producer flow */}
        <Route path="/producer" element={<Producer />} />
        <Route path="/producer/:producerId/projects" element={<Projects />} />

        {/* Project detail */}
        <Route path="/projects/:projectId" element={<Project />} />

        {/* Admin / Tools */}
        <Route path="/admin" element={<Admin />} />
        <Route path="/export-tools" element={<ExportTools />} />

        {/* Mini-site */}
        <Route path="/minisite/:projectId" element={<MiniSiteProviderShell />}>
          <Route path="catalog" element={<Catalog />} />
          <Route path="album" element={<Album />} />
          <Route path="meta" element={<Meta />} />
          <Route path="nft-mix" element={<NftMix />} />
          <Route path="songs" element={<Songs />} />
          <Route path="export" element={<ExportTools />} />
        </Route>

        {/* Default */}
        <Route path="/" element={<Navigate to="/producer" replace />} />
        <Route path="*" element={<Navigate to="/producer" replace />} />
      </Route>
    </Routes>
  );
}
