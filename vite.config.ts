import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import fs from "fs";

export default defineConfig({
  envDir: "env",
  server: {
    proxy: {
      '/api': {
        target: 'https://37-156-46-47.sslip.io',
        changeOrigin: true,
      }
    }
  },
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: (id) => ["electron-updater", "electron-log"].some(pkg => id === pkg || id.startsWith(pkg + "/")),
            },
          },
        },
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
