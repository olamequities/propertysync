const { app, BrowserWindow, dialog, ipcMain } = require("electron");
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

// Resolves when the update check concludes: no update, error, or downloaded.
// Used to gate main window creation so login is blocked while updating.
let resolveUpdateGate;
const updateGate = new Promise((r) => { resolveUpdateGate = r; });
function releaseUpdateGate() {
  if (resolveUpdateGate) { resolveUpdateGate(); resolveUpdateGate = null; }
}

function setSplashStatus(text, percent) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const js = `window.__setStatus && window.__setStatus(${JSON.stringify(text)}, ${typeof percent === "number" ? percent : "null"});`;
  splashWindow.webContents.executeJavaScript(js).catch(() => {});
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", status);
  }
}

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("updater:check", async () => {
  if (isDev) {
    return { ok: false, error: "Auto-update disabled in development mode" };
  }
  try {
    sendUpdateStatus({ state: "checking" });
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return { ok: false, error: "No update info returned" };
    }
    return {
      ok: true,
      currentVersion: app.getVersion(),
      latestVersion: result.updateInfo.version,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

autoUpdater.on("checking-for-update", () => {
  console.log("[updater] Checking for updates...");
  sendUpdateStatus({ state: "checking" });
  setSplashStatus("Checking for updates…");
});

autoUpdater.on("update-available", (info) => {
  console.log("[updater] Update available:", info.version);
  sendUpdateStatus({ state: "available", version: info.version });
  setSplashStatus(`Downloading update v${info.version}…`, 0);
});

autoUpdater.on("download-progress", (progress) => {
  const pct = Math.round(progress.percent);
  console.log(`[updater] Downloading: ${pct}%`);
  sendUpdateStatus({ state: "downloading", percent: pct });
  setSplashStatus(`Downloading update… ${pct}%`, pct);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(progress.percent / 100);
    mainWindow.setTitle(`PropScope — Downloading update ${pct}%`);
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] Update downloaded:", info.version);
  sendUpdateStatus({ state: "downloaded", version: info.version });
  setSplashStatus(`Installing v${info.version}…`);
  // If the main window hasn't opened yet, install immediately —
  // the user is still on the splash screen, so no login to interrupt.
  if (!mainWindow || mainWindow.isDestroyed()) {
    setTimeout(() => autoUpdater.quitAndInstall(), 400);
    return;
  }
  mainWindow.setProgressBar(-1);
  mainWindow.setTitle(`PropScope v${app.getVersion()}`);
  dialog
    .showMessageBox(mainWindow, {
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
    })
    .catch(() => {});
});

autoUpdater.on("update-not-available", (info) => {
  console.log("[updater] App is up to date");
  const ver = (info && info.version) || app.getVersion();
  sendUpdateStatus({ state: "not-available", version: ver });
  releaseUpdateGate();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const original = `PropScope v${app.getVersion()}`;
    mainWindow.setTitle(`${original} — up to date (latest: ${ver})`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(original);
    }, 5000);
  }
});

autoUpdater.on("error", (err) => {
  console.error("[updater] Error:", err.message);
  sendUpdateStatus({ state: "error", error: err.message });
  releaseUpdateGate();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(-1);
    const original = `PropScope v${app.getVersion()}`;
    mainWindow.setTitle(`${original} — update check failed`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(original);
    }, 5000);
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

  const found = findFile(path.join(process.resourcesPath, "app"), "server.js");
  if (!found) {
    console.error("[next] Could not find server.js. Checked:", candidates.join(", "));
  }
  return found;
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const doResolve = () => { if (!settled) { settled = true; clearTimeout(fallbackTimeout); resolve(); } };
    const doReject = (err) => { if (!settled) { settled = true; clearTimeout(fallbackTimeout); reject(err); } };

    if (isDev) {
      doResolve();
      return;
    }

    const serverPath = findNextServer();
    if (!serverPath) {
      doReject(new Error("Could not find Next.js server"));
      return;
    }

    const env = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
    };

    // Load env file from resources, next to exe, or project root
    const envPaths = [
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, ".env.local"),
      path.join(path.dirname(process.execPath), ".env"),
      path.join(path.dirname(process.execPath), ".env.local"),
      path.join(process.cwd(), ".env"),
      path.join(process.cwd(), ".env.local"),
    ];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        console.log("[env] Loading", envPath);
        const content = fs.readFileSync(envPath, "utf-8");
        // Parse env file supporting multi-line quoted values (e.g. PEM keys)
        // Matches: KEY="value...possibly multiline..." or KEY='...' or KEY=value
        const regex = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\r\n]*)/gm;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const key = match[1];
          let val = match[2];
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
            // Unescape \n in double-quoted values (standard dotenv behavior)
            if (match[2].startsWith('"')) {
              val = val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
            }
          } else {
            val = val.trim();
          }
          env[key] = val;
        }
        console.log("[env] Loaded keys:", Object.keys(env).filter(k =>
          k.startsWith("GOOGLE") || k.startsWith("AUTH") || k.startsWith("JWT")
        ).join(", "));
        break;
      }
    }

    const serverDir = path.dirname(serverPath);
    console.log("[next] Starting server from:", serverPath);
    console.log("[next] CWD:", serverDir);

    // Copy .env.local next to server.js so Next.js reads it natively
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
      console.log("[next] Copying static files...");
      fs.mkdirSync(path.join(serverDir, ".next"), { recursive: true });
      fs.cpSync(staticSrc, staticDest, { recursive: true });
    }

    const publicSrc = path.join(process.resourcesPath, "app", "public");
    const publicDest = path.join(serverDir, "public");
    if (fs.existsSync(publicSrc) && !fs.existsSync(publicDest)) {
      console.log("[next] Copying public files...");
      fs.cpSync(publicSrc, publicDest, { recursive: true });
    }

    // Use Electron's bundled Node binary instead of system "node"
    const nodeBin = process.execPath;
    try {
      nextServer = spawn(nodeBin, [serverPath], {
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "pipe",
        cwd: serverDir,
      });
    } catch (err) {
      doReject(new Error(`Failed to spawn server: ${err.message}`));
      return;
    }

    nextServer.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[next]", msg.trim());
      if (msg.includes("Ready") || msg.includes("started") || msg.includes("listening")) {
        doResolve();
      }
    });

    nextServer.stderr.on("data", (data) => {
      console.error("[next:err]", data.toString().trim());
    });

    nextServer.on("error", (err) => {
      console.error("[next] Failed to start:", err.message);
      doReject(err);
    });

    nextServer.on("exit", (code) => {
      console.log(`[next] Server exited with code ${code}`);
      if (code !== 0 && code !== null) {
        doReject(new Error(`Next.js server exited with code ${code}`));
      }
    });

    // Fallback: resolve after 10s
    const fallbackTimeout = setTimeout(() => {
      console.log("[next] Timeout fallback — assuming server is ready");
      doResolve();
    }, 10000);
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

  splashWindow.loadFile(path.join(__dirname, "splash.html"), {
    query: { v: app.getVersion() },
  });
  splashWindow.center();
}

// ─── Window ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: `PropScope v${app.getVersion()}`,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // F12 or Ctrl+Shift+I toggles DevTools (works in packaged builds).
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const isF12 = input.key === "F12";
    const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === "i";
    if (isF12 || isCtrlShiftI) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  let shown = false;
  function showMainWindow() {
    if (shown) return;
    shown = true;
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  }

  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", showMainWindow);
  setTimeout(showMainWindow, 8000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Kill server safely ─────────────────────────────────────
function killServer() {
  if (!nextServer) return;
  try {
    nextServer.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      try { nextServer.kill("SIGKILL"); } catch {}
    }, 5000);
    nextServer.once("exit", () => clearTimeout(forceKill));
  } catch {}
  nextServer = null;
}

// ─── App lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    showSplash();

    if (isDev) {
      releaseUpdateGate();
    } else {
      // Kick off the update check in parallel with the server boot.
      // If the network is slow or offline, don't block startup forever.
      setSplashStatus("Checking for updates…");
      autoUpdater.checkForUpdates().catch((err) => {
        console.error("[updater] check failed:", err && err.message);
        releaseUpdateGate();
      });
      setTimeout(() => {
        console.log("[updater] gate timeout — proceeding without update");
        releaseUpdateGate();
      }, 15000);
    }

    await startNextServer();
    await waitForPort(PORT);

    // Wait for updater to conclude before showing the login window.
    // If an update downloads, quitAndInstall fires and the app restarts —
    // the gate intentionally never resolves in that case.
    setSplashStatus("Starting PropScope…");
    await updateGate;

    createWindow();
  } catch (err) {
    killServer();
    dialog.showErrorBox("Startup Error", `Failed to start: ${err.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServer();
  app.quit();
});

app.on("before-quit", () => {
  killServer();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
