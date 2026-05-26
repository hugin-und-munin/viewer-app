import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import log from "electron-log/main";
import pkg from "electron-updater";
const { autoUpdater } = pkg;

log.initialize();
autoUpdater.logger = log;
import fs from "fs/promises";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function registerConfigHandlers() {
  ipcMain.handle("config:get", () => ({
    deviceId: process.env.DEVICE_ID ?? "",
    token:    process.env.API_TOKEN  ?? "",
  }));
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

  autoUpdater.on("checking-for-update", () => log.info("[updater] checking for update..."));
  autoUpdater.on("update-available", (info) => log.info("[updater] update available:", info.version));
  autoUpdater.on("update-not-available", (info) => log.info("[updater] up to date:", info.version));
  autoUpdater.on("error", (err) => log.error("[updater] error:", err));

  autoUpdater.checkForUpdates();

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox({
      type: "info",
      title: "Update ready",
      message: "A new version has been downloaded. Restart the app to apply the update.",
      buttons: ["Restart now", "Later"],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
}

app.whenReady().then(() => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  registerConfigHandlers();
  registerCacheHandlers();
  const win = createWindow();
  startControlServer(win);
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
