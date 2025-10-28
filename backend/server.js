// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const { AccessToken } = require("livekit-server-sdk"); // ✅ LiveKit v2.14+ compatible

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --------------------
// MongoDB Connection
// --------------------
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --------------------
// Auth Routes
// --------------------
app.use("/api/auth", require("./routes/auth"));

// --------------------
// LiveKit Token Route
// --------------------
app.post("/api/livekit/token", async (req, res) => {
  const { userName, roomName } = req.body;

  try {
    // ✅ Input validation
    if (!userName || !roomName) {
      return res.status(400).json({ error: "Missing userName or roomName" });
    }

    // ✅ Ensure environment variables exist
    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      console.error("❌ Missing LiveKit credentials in .env");
      return res.status(500).json({ error: "LiveKit configuration missing" });
    }

    // ✅ Create LiveKit Access Token (v2.x structure)
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userName,
      ttl: "1h", // token valid for 1 hour
    });

    // ✅ Grant permissions for the room
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    console.log(`🎟️ Token generated for user: ${userName} | Room: ${roomName}`);

    // ✅ Return token + LiveKit URL to client
    return res.json({
      token,
      url: LIVEKIT_URL,
    });
  } catch (error) {
    console.error("❌ Error generating LiveKit token:", error);
    return res.status(500).json({ error: "Failed to generate LiveKit token" });
  }
});

// --------------------
// Socket.IO for Call Signaling
// --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Track connected users: userId → { socketId, userName }
let onlineUsers = {};

io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  // ✅ Register user
  socket.on("register-user", ({ userId, userName }) => {
    if (!userId || !userName) return;
    onlineUsers[userId] = { socketId: socket.id, userName };
    console.log(`✅ Registered: ${userName} (${userId})`);
  });

  // ✅ Initiate a call
  socket.on("call-user", ({ toUserId, fromUserId, roomName }) => {
    const callee = onlineUsers[toUserId];
    if (callee && onlineUsers[fromUserId]) {
      io.to(callee.socketId).emit("incoming-call", {
        fromUserId,
        fromUserName: onlineUsers[fromUserId].userName,
        roomName,
      });
      console.log(
        `📞 ${onlineUsers[fromUserId].userName} is calling ${callee.userName} in room ${roomName}`
      );
    }
  });

  // ✅ Handle accept/reject response
  socket.on("call-response", ({ toUserId, accepted, roomName }) => {
    const caller = onlineUsers[toUserId];
    if (caller) {
      io.to(caller.socketId).emit("call-response", { accepted, roomName });
      console.log(
        `📲 Call ${accepted ? "accepted ✅" : "rejected ❌"} for room ${roomName}`
      );
    }
  });

  // ✅ Handle disconnect
  socket.on("disconnect", () => {
    for (let userId in onlineUsers) {
      if (onlineUsers[userId].socketId === socket.id) {
        console.log(`❌ Disconnected: ${onlineUsers[userId].userName}`);
        delete onlineUsers[userId];
        break;
      }
    }
  });
});

// --------------------
// Start Server
// --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Socket.IO & LiveKit`);
});
