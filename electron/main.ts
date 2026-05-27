import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import pkg from "electron-updater";
const { autoUpdater } = pkg;

log.initialize();
autoUpdater.logger = log;
import fs from "fs/promises";
import { readFileSync } from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envPaths = app.isPackaged
    ? [path.join(app.getPath("userData"), ".env")]
    : [
        path.join(app.getAppPath(), "env", ".env.local"),  // local overrides (git-ignored, loaded first = wins)
        path.join(app.getAppPath(), "env", ".env"),        // base values (fills gaps)
      ];

  for (const envPath of envPaths) {
    try {
      const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["'](.*)["']$/, "$1");
        if (key && !(key in process.env)) process.env[key] = val;
      }
      log.info(`[env] loaded: ${envPath}`);
    } catch {
      log.info(`[env] no .env file at ${envPath}, skipping`);
    }
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    const msg = `[config] Required environment variable "${key}" is not set.`;
    log.error(msg);
    throw new Error(msg);
  }
  return value;
}

function registerConfigHandlers() {
  ipcMain.handle("config:get", () => ({
    // all values come from the .env file in %APPDATA%\viewer-app\
    deviceId:                 requireEnv("DEVICE_ID"),
    token:                    requireEnv("API_TOKEN"),
    apiUrl:                   requireEnv("VITE_API_URL"),
    disableCache:             process.env.VITE_DISABLE_CACHE    === "true",
    disablePrefetch:          process.env.VITE_DISABLE_PREFETCH === "true",
    cacheTtlMs:               Number(process.env.VITE_CACHE_TTL_MS               ?? 0),
    appsettingsLookaheadDays: Number(process.env.VITE_APPSETTINGS_LOOKAHEAD_DAYS ?? 3),
    controlEnabled:           process.env.VITE_CONTROL_ENABLED  === "true",
  }));
  ipcMain.handle("app:version", () => app.getVersion());
}

function registerCacheHandlers() {
  ipcMain.handle("cache:read", async (_event, filename: string): Promise<string | null> => {
    const filePath = path.join(app.getPath("userData"), filename);
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  });

  ipcMain.handle("cache:write", async (_event, filename: string, data: string): Promise<void> => {
    const filePath = path.join(app.getPath("userData"), filename);
    const tmpPath = `${filePath}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, data, "utf-8");
    await fs.rename(tmpPath, filePath);
  });
}

function startControlServer(win: BrowserWindow) {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        win.webContents.send("control:command", data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
  });

  server.listen(3001, () => {
    console.log("[ControlServer] listening on http://localhost:3001");
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: app.isPackaged
          ? path.join(__dirname, "preload.cjs")
          : path.join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // In dev load Vite dev server, in prod load built index.html
  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.allowPrerelease = app.getVersion().includes("-");
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "hugin-und-munin",
    repo: "viewer-app",
    token: process.env.GH_UPDATE_TOKEN ?? "",
  });

  autoUpdater.on("checking-for-update", () => log.info("[updater] checking for update..."));
  autoUpdater.on("update-available", (info) => log.info("[updater] update available:", info.version));
  autoUpdater.on("update-not-available", (info) => log.info("[updater] up to date:", info.version));
  autoUpdater.on("error", (err) => log.error("[updater] error:", err));

  autoUpdater.checkForUpdates();

  autoUpdater.on("update-downloaded", () => {
    log.info("[updater] update downloaded, will install on next restart");
  });
}

app.whenReady().then(() => {
  loadEnvFile();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  registerConfigHandlers();
  registerCacheHandlers();
  const win = createWindow();
  if (process.env.VITE_CONTROL_ENABLED === "true") startControlServer(win);
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
