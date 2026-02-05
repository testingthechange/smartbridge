// FILE: src/app/routes.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "./AppLayout.jsx";
import AdminSend from "./AdminSend.jsx";

import Projects from "../pages/Projects.jsx";
// import Project from "../pages/Project.jsx"; // optional if you want it
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      {/* Root should NOT go to /admin/send */}
      <Route path="/" element={<Navigate to="/admin" replace />} />

      {/* ADMIN area with sidebar */}
      <Route path="/admin" element={<AppLayout />}>
        <Route index element={<Projects />} />
        <Route path="send" element={<AdminSend />} />
        {/* Add more admin routes here as needed */}
        {/* <Route path="project/:projectId" element={<Project />} /> */}
      </Route>

      {/* MINISITE */}
      <Route path="/minisite/:projectId/:page" element={<MiniSiteLayout />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
