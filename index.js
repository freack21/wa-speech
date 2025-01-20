const CONFIG = require("./config.json");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");

const WAuto = require("whatsauto.js");

const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const PORT = CONFIG.port || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/test.html"));
});

app.use((req, res, next) => {
  res.status(200).json({
    message: "Server is running!",
  });
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const sessionPath = path.join(__dirname, "sessions.json");
var connectedSessions = {};
function loadSessions() {
  let session = {};
  try {
    if (fs.existsSync(sessionPath)) {
      session = JSON.parse(fs.readFileSync(sessionPath));
    }
  } catch (error) {
    console.log(`Error loading sessions: ${error}`);
  }
  return session;
}

function isSessionExists(session) {
  let sessions = loadSessions();
  for (const key in sessions) {
    if (sessions[key] === session) return true;
  }
}

function getIdSocket(session) {
  let sessions = loadSessions();
  for (const key in sessions) {
    if (sessions[key] === session) return key;
  }
}

function addSession(id, session) {
  try {
    let sessions = loadSessions();
    if (isSessionExists(session)) {
      delete sessions[getIdSocket(session)];
    }
    sessions[id] = session;
    fs.writeFileSync(sessionPath, JSON.stringify(sessions));
  } catch (error) {
    console.log(`Error adding session: ${error}`);
  }
}

function removeSession(session) {
  try {
    let sessions = loadSessions();
    connectedSessions[session]?.autoWA?.end();
    delete connectedSessions[session];
    delete sessions[getIdSocket(session)];
    fs.writeFileSync(sessionPath, JSON.stringify(sessions));
  } catch (error) {
    console.log(`Error removing session: ${error}`);
  }
}

async function startWhatsAuto(session) {
  if (!connectedSessions[session]) {
    connectedSessions[session] = { autoWA: null, connected: false };
  }
  if (connectedSessions[session].connected) return;
  try {
    const autoWA = new WAuto.AutoWA(session);
    if (!connectedSessions[session]?.autoWA) {
      connectedSessions[session].autoWA = autoWA;
    }
    autoWA.event.onQRUpdated(async (qr) => {
      io.to(getIdSocket(session)).emit("wa_qr", {
        qr,
        img_qr: await qrcode.toDataURL(qr),
      });
    });
    autoWA.event.onConnected(() => {
      io.to(getIdSocket(session)).emit("wa_connected", session);
      connectedSessions[session].connected = true;
    });
    autoWA.event.onDisconnected(() => {
      io.to(getIdSocket(session)).emit("wa_disconnected", session);
      connectedSessions[session].connected = false;
    });
    autoWA.event.onGroupMessageReceived(async (message) => {
      const groupInfo = await autoWA.sock.groupMetadata(message.from);
      message.groupName = groupInfo.subject;
      io.to(getIdSocket(session)).emit("wa_group_msg", message);
    });
    autoWA.event.onPrivateMessageReceived((message) => {
      io.to(getIdSocket(session)).emit("wa_private_msg", message);
    });
    await autoWA.initialize();
  } catch (error) {
    console.log(`Error starting WhatsAuto: ${error}`);
  }
}

io.on("connection", (socket) => {
  socket.on("login", async (session) => {
    addSession(socket.id, session);
    if (session) {
      await startWhatsAuto(session);
    }
  });

  socket.on("add_session", async (session) => {
    if (isSessionExists(session)) {
      return io.to(socket.id).emit("session_exists", session);
    }
    addSession(socket.id, session);
    await startWhatsAuto(session);
  });

  socket.on("remove_session", (session) => {
    removeSession(session);
  });
});

server.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
