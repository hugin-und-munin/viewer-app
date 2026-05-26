import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import fs from "fs";

export default defineConfig({
  envDir: "env",
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
      },
    ]),
    {
      // Copy the preload CJS file to dist-electron/ on production build
      name: "copy-preload",
      closeBundle() {
        fs.copyFileSync("electron/preload.cjs", "dist-electron/preload.cjs");
      },
    },
  ],
});
