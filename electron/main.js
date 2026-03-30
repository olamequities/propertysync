const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

let mainWindow;
let nextServer;
const PORT = 3000;
const isDev = process.argv.includes("--dev") || !app.isPackaged;

// ─── Auto-updater ───────────────────────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  console.log("[updater] Update available:", info.version);
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(
      `document.title = "PropScope — Updating to v${info.version}..."`
    );
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] Update downloaded:", info.version);
  dialog
    .showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: `Version ${info.version} has been downloaded. Restart now to update?`,
      buttons: ["Restart", "Later"],
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("error", (err) => {
  console.error("[updater] Error:", err.message);
});

// ─── Next.js Server ─────────────────────────────────────────
function findNextServer() {
  if (isDev) return null;

  const fs = require("fs");
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

    // Load .env.local from next to the exe or the app resources
    const fs = require("fs");
    const envPaths = [
      path.join(path.dirname(process.execPath), ".env.local"),
      path.join(process.resourcesPath, ".env.local"),
    ];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf-8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const [key, ...rest] = trimmed.split("=");
            env[key.trim()] = rest.join("=").trim();
          }
        }
        break;
      }
    }

    nextServer = spawn("node", [serverPath], {
      env,
      stdio: "pipe",
      cwd: path.dirname(serverPath),
    });

    nextServer.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[next]", msg);
      if (msg.includes("Ready") || msg.includes("started")) {
        resolve();
      }
    });

    nextServer.stderr.on("data", (data) => {
      console.error("[next:err]", data.toString());
    });

    nextServer.on("error", reject);
    nextServer.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Next.js server exited with code ${code}`);
      }
    });

    setTimeout(resolve, 5000);
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

// ─── Window ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "PropScope",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
  try {
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
