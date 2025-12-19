// src/app/App.jsx
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext.jsx";

// UI
import SideNav from "../components/SideNav.jsx";

// Pages
import Login from "../pages/Login.jsx";
import Producer from "../pages/Producer.jsx";
import Projects from "../pages/Projects.jsx";
import Project from "../pages/Project.jsx";

// Tools / Export
import ExportTools from "../pages/ExportTools.jsx";

// Optional (keep ONLY if files exist)
import Admin from "../pages/Admin.jsx";

// Mini-site pages
import Catalog from "../minisite/Catalog.jsx";
import Album from "../minisite/Album.jsx";
import Meta from "../minisite/Meta.jsx";
import NftMix from "../minisite/NftMix.jsx";
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

export default function App() {
  return (
    <ProjectMiniSiteProvider>
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
          <Route path="/minisite/:projectId/catalog" element={<Catalog />} />
          <Route path="/minisite/:projectId/album" element={<Album />} />
          <Route path="/minisite/:projectId/meta" element={<Meta />} />
          <Route path="/minisite/:projectId/nft-mix" element={<NftMix />} />
          <Route path="/minisite/:projectId/songs" element={<Songs />} />

          {/* Default */}
          <Route path="/" element={<Navigate to="/producer" replace />} />
          <Route path="*" element={<Navigate to="/producer" replace />} />
        </Route>
      </Routes>
    </ProjectMiniSiteProvider>
  );
}
