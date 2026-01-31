// FILE: src/app/App.jsx
import React from "react";
import AppRoutes from "./routes.jsx";
import { ProjectMiniSiteProvider } from "../ProjectMiniSiteContext";

export default function App() {
  return (
    <ProjectMiniSiteProvider>
      <AppRoutes />
    </ProjectMiniSiteProvider>
  );
}
