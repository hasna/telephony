import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: { "/api": "http://localhost:19451", "/webhooks": "http://localhost:19451" },
  },
});
