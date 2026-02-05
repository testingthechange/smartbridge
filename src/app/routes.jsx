import React from "react";
import { Routes, Route } from "react-router-dom";
import AdminSend from "./AdminSend.jsx";
import MiniSiteLayout from "../minisite/MiniSiteLayout.jsx";

function PublicHome() {
  return (
    <div style={{ padding: 40 }}>
      <h1>BlockOne</h1>
      <p>Public site placeholder.</p>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public root */}
      <Route path="/" element={<PublicHome />} />

      {/* Admin */}
      <Route path="/admin/send" element={<AdminSend />} />

      {/* Producer minisite */}
      <Route path="/minisite/:projectId/*" element={<MiniSiteLayout />} />
    </Routes>
  );
}
