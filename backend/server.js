const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { AccessToken } = require("livekit-server-sdk");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// 🧩 MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// 🧩 Routes
app.use("/api/auth", require("./routes/auth"));

// ✅ LiveKit token route (added)
app.post("/api/livekit/token", (req, res) => {
  const { userName, roomName } = req.body;

  if (!userName || !roomName) {
    return res.status(400).json({ error: "Missing userName or roomName" });
  }

  try {
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: userName }
    );

    at.addGrant({
      roomJoin: true,
      room: roomName,
    });

    const token = at.toJwt();
    res.json({ token });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// 🧩 Create server and attach Socket.IO
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*", // allow all for now
    methods: ["GET", "POST"]
  }
});

// 🧩 Store online users
let onlineUsers = {}; // userId -> socketId

io.on("connection", (socket) => {
  console.log("a user connected: " + socket.id);

  // Register user
  socket.on("register-user", (userId) => {
    onlineUsers[userId] = socket.id;
    console.log("Registered user:", userId);
  });

  // Handle call initiation
  socket.on("call-user", ({ toUserId, fromUserId }) => {
    const calleeSocket = onlineUsers[toUserId];
    if (calleeSocket) {
      io.to(calleeSocket).emit("incoming-call", { fromUserId });
    }
  });

  // Handle call response (accept/decline)
  socket.on("call-response", ({ toUserId, accepted }) => {
    const callerSocket = onlineUsers[toUserId];
    if (callerSocket) {
      io.to(callerSocket).emit("call-response", { accepted });
    }
  });

  // WebRTC offer
  socket.on("webrtc-offer", ({ toUserId, sdp }) => {
    const calleeSocket = onlineUsers[toUserId];
    if (calleeSocket) {
      const fromUserId = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
      io.to(calleeSocket).emit("webrtc-offer", { sdp, fromUserId });
    }
  });

  // WebRTC answer
  socket.on("webrtc-answer", ({ toUserId, sdp }) => {
    const callerSocket = onlineUsers[toUserId];
    if (callerSocket) {
      io.to(callerSocket).emit("webrtc-answer", { sdp });
    }
  });

  // WebRTC ICE candidate
  socket.on("webrtc-ice-candidate", ({ toUserId, candidate }) => {
    const peerSocket = onlineUsers[toUserId];
    if (peerSocket) {
      io.to(peerSocket).emit("webrtc-ice-candidate", { candidate });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (let key in onlineUsers) {
      if (onlineUsers[key] === socket.id) delete onlineUsers[key];
    }
    console.log("user disconnected: " + socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with Socket.IO & LiveKit`));
