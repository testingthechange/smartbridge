// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: ["index.html"], // IMPORTANT: do not scan nested smartbridge/index.html
  },
  server: {
    watch: {
      ignored: ["**/smartbridge/**"], // avoid double-watch loops
    },
  },
});
