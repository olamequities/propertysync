const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

let mainWindow;
let splashWindow;
let nextServer;
const PORT = 3000;
const isDev = process.argv.includes("--dev") || !app.isPackaged;

// ─── Auto-updater ───────────────────────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("checking-for-update", () => {
  console.log("[updater] Checking for updates...");
});

autoUpdater.on("update-available", (info) => {
  console.log("[updater] Update available:", info.version);
  const win = mainWindow || splashWindow;
  if (win) {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Update Available",
      message: `Version ${info.version} is downloading in the background. You'll be notified when it's ready.`,
      buttons: ["OK"],
    });
  }
});

autoUpdater.on("download-progress", (progress) => {
  const pct = Math.round(progress.percent);
  console.log(`[updater] Downloading: ${pct}%`);
  if (mainWindow) {
    mainWindow.setProgressBar(progress.percent / 100);
    mainWindow.setTitle(`PropScope — Downloading update ${pct}%`);
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] Update downloaded:", info.version);
  if (mainWindow) {
    mainWindow.setProgressBar(-1);
    mainWindow.setTitle("PropScope");
  }
  dialog
    .showMessageBox(mainWindow || splashWindow, {
      type: "info",
      title: "Update Ready",
      message: `Version ${info.version} is ready to install. Restart now?`,
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("update-not-available", () => {
  console.log("[updater] App is up to date");
});

autoUpdater.on("error", (err) => {
  console.error("[updater] Error:", err.message);
  if (mainWindow) {
    mainWindow.setProgressBar(-1);
    mainWindow.setTitle("PropScope");
  }
});

// ─── Next.js Server ─────────────────────────────────────────
function findNextServer() {
  if (isDev) return null;


  const candidates = [
    path.join(process.resourcesPath, "app", "server.js"),
    path.join(process.resourcesPath, "app", "flow", "olam", "olam-app", "server.js"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  function findFile(dir, name, depth = 0) {
    if (depth > 4) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name === name) return path.join(dir, e.name);
        if (e.isDirectory() && e.name !== "node_modules") {
          const found = findFile(path.join(dir, e.name), name, depth + 1);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }

  return findFile(path.join(process.resourcesPath, "app"), "server.js");
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      resolve();
      return;
    }

    const serverPath = findNextServer();
    if (!serverPath) {
      reject(new Error("Could not find Next.js server"));
      return;
    }

    const env = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
    };

    // Load .env.local from resources, next to exe, or project root
    const envPaths = [
      path.join(process.resourcesPath, ".env.local"),
      path.join(path.dirname(process.execPath), ".env.local"),
      path.join(process.cwd(), ".env.local"),
    ];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        console.log("[env] Loading", envPath);
        const content = fs.readFileSync(envPath, "utf-8");
        // Parse .env handling quoted values (including multiline-safe private keys)
        const regex = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/gm;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const key = match[1];
          let val = match[2].trim();
          // Strip surrounding quotes
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          env[key] = val;
        }
        console.log("[env] Loaded keys:", Object.keys(env).filter(k => k.startsWith("GOOGLE") || k.startsWith("AUTH") || k.startsWith("JWT")).join(", "));
        break;
      }
    }

    console.log("[next] Starting server from:", serverPath);
    console.log("[next] CWD:", path.dirname(serverPath));

    // Also copy .env.local next to server.js so Next.js can read it natively
    const serverDir = path.dirname(serverPath);
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const destEnv = path.join(serverDir, ".env.local");
        if (!fs.existsSync(destEnv)) {
          try {
            fs.copyFileSync(envPath, destEnv);
            console.log("[env] Copied .env.local to", destEnv);
          } catch (e) {
            console.error("[env] Failed to copy .env.local:", e.message);
          }
        }
        break;
      }
    }

    // Copy .next/static and public into the server directory if needed
    const staticSrc = path.join(process.resourcesPath, "app", ".next", "static");
    const staticDest = path.join(serverDir, ".next", "static");
    if (fs.existsSync(staticSrc) && !fs.existsSync(staticDest)) {
      console.log("[next] Linking static files...");
      fs.mkdirSync(path.join(serverDir, ".next"), { recursive: true });
      fs.cpSync(staticSrc, staticDest, { recursive: true });
    }

    const publicSrc = path.join(process.resourcesPath, "app", "public");
    const publicDest = path.join(serverDir, "public");
    if (fs.existsSync(publicSrc) && !fs.existsSync(publicDest)) {
      console.log("[next] Linking public files...");
      fs.cpSync(publicSrc, publicDest, { recursive: true });
    }

    nextServer = spawn("node", [serverPath], {
      env,
      stdio: "pipe",
      cwd: serverDir,
    });

    nextServer.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[next]", msg);
      if (msg.includes("Ready") || msg.includes("started") || msg.includes("listening")) {
        resolve();
      }
    });

    nextServer.stderr.on("data", (data) => {
      console.error("[next:err]", data.toString());
    });

    nextServer.on("error", (err) => {
      console.error("[next] Failed to start:", err.message);
      reject(err);
    });

    nextServer.on("exit", (code) => {
      console.log(`[next] Server exited with code ${code}`);
      if (code !== 0 && code !== null) {
        reject(new Error(`Next.js server exited with code ${code}`));
      }
    });

    // Fallback: resolve after 8s
    setTimeout(() => {
      console.log("[next] Timeout fallback — assuming server is ready");
      resolve();
    }, 8000);
  });
}

// ─── Port check ─────────────────────────────────────────────
function waitForPort(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1000);

      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });

      socket.on("timeout", () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });

      socket.connect(port, "127.0.0.1");
    }

    tryConnect();
  });
}

// ─── Splash Screen ──────────────────────────────────────────
function showSplash() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

// ─── Window ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "PropScope",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Show main window when ready, or after 8s timeout
  let shown = false;
  function showMainWindow() {
    if (shown) return;
    shown = true;
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  }

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", showMainWindow);
  setTimeout(showMainWindow, 8000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    showSplash();
    await startNextServer();
    await waitForPort(PORT);
    createWindow();

    // Check for updates (production only)
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  } catch (err) {
    dialog.showErrorBox("Startup Error", `Failed to start: ${err.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (nextServer) nextServer.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (nextServer) nextServer.kill();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
