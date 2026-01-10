import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app/App.jsx";
import { ProjectMiniSiteProvider } from "./ProjectMiniSiteContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProjectMiniSiteProvider>
        <App />
      </ProjectMiniSiteProvider>
    </BrowserRouter>
  </React.StrictMode>
);
// ping Sat Jan 10 15:17:00 PST 2026
