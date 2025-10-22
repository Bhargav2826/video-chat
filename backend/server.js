// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const { AccessToken, VideoGrant } = require("livekit-server-sdk"); // ✅ Correct import

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// --------------------
// MongoDB connection
// --------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// --------------------
// Auth routes
// --------------------
app.use("/api/auth", require("./routes/auth"));

// --------------------
// LiveKit token route
// --------------------
app.post("/api/livekit/token", (req, res) => {
  const { userName, roomName } = req.body;
  if (!userName || !roomName) {
    return res.status(400).json({ error: "Missing userName or roomName" });
  }

  try {
    // Generate LiveKit access token
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: userName }
    );

    // Grant access to the specified room
    const grant = new VideoGrant({ room: roomName });
    at.addGrant(grant);

    const token = at.toJwt();
    console.log(`🎟️ Generated LiveKit token for ${userName} in room ${roomName}`);

    res.json({
      token,
      url: process.env.LIVEKIT_URL,
    });
  } catch (err) {
    console.error("❌ Error generating LiveKit token:", err);
    res.status(500).json({ error: "Failed to generate LiveKit token" });
  }
});

// --------------------
// Socket.IO for call signaling
// --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Store online users: userId -> { socketId, userName }
let onlineUsers = {};

io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  // Register user
  socket.on("register-user", ({ userId, userName }) => {
    if (!userId || !userName) return;
    onlineUsers[userId] = { socketId: socket.id, userName };
    console.log("✅ Socket registered for userId:", userId);
  });

  // Initiate call
  socket.on("call-user", ({ toUserId, fromUserId, roomName }) => {
    const callee = onlineUsers[toUserId];
    if (callee && onlineUsers[fromUserId]) {
      io.to(callee.socketId).emit("incoming-call", {
        fromUserId,
        fromUserName: onlineUsers[fromUserId].userName,
        roomName,
      });
      console.log(`📞 ${onlineUsers[fromUserId].userName} is calling ${callee.userName} in room ${roomName}`);
    }
  });

  // Handle call response
  socket.on("call-response", ({ toUserId, accepted, roomName }) => {
    const caller = onlineUsers[toUserId];
    if (caller) {
      io.to(caller.socketId).emit("call-response", { accepted, roomName });
      console.log(`📲 Call ${accepted ? "accepted ✅" : "rejected ❌"} for room ${roomName}`);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (let key in onlineUsers) {
      if (onlineUsers[key].socketId === socket.id) {
        console.log(`❌ User disconnected: ${onlineUsers[key].userName}`);
        delete onlineUsers[key];
      }
    }
  });
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} with Socket.IO & LiveKit`);
});
