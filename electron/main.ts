import { app, BrowserWindow, ipcMain, session } from "electron";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    width: 1280,
    height: 720,
    webPreferences: {
      preload: app.isPackaged
          ? path.join(__dirname, "preload.cjs")
          : path.join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev load Vite dev server, in prod load built index.html
  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  registerCacheHandlers();
  const win = createWindow();
  startControlServer(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
