import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { AccessToken } from "livekit-server-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@deepgram/sdk";
import SpeechModel from "./models/Speech.js";
import CounterModel from "./models/Counter.js";
import CallModel from "./models/Call.js";

// Routes
import authRoutes from "./routes/auth.js";
import speechRoutes from "./speech/speechRoutes.js";
import transcriptionRoutes from "./routes/transcription.js";

// --- Setup Paths & Config ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

console.log("📂 Server __dirname:", __dirname);
const clientBuildPath = path.join(__dirname, "../client/build");
console.log("📂 Client Build Path:", clientBuildPath);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// --- Static Files (Frontend) ---
// Serve static files BEFORE API routes to catch specific assets
// Check if build exists, log it
if (fs.existsSync(clientBuildPath)) {
  console.log("✅ Client build directory exists.");
} else {
  console.error("❌ Client build directory MISSING at:", clientBuildPath);
}
app.use(express.static(clientBuildPath));

// --- Debug Endpoint ---
app.get("/debug-files", (req, res) => {
  try {
    if (fs.existsSync(clientBuildPath)) {
      const files = fs.readdirSync(clientBuildPath);
      // Recursively get js files to verify main.js
      res.json({ path: clientBuildPath, exists: true, rootFiles: files });
    } else {
      res.json({ path: clientBuildPath, exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- MongoDB Connection --------------------
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

app.use("/api/auth", authRoutes);
app.use("/api/speech", speechRoutes);
app.use("/api/transcription", transcriptionRoutes);

// -------------------- Catch-All for React Router --------------------
// Define this function to be reused or placed at the end? 
// No, we will define the catch-all handler here but place it AFTER API routes.
// However, the original code had it at the bottom. I'll just remove the OLD static serve block at the bottom
// and let the catch-all be handled there (or move it up).
// Actually, in Express, catch-all *must* be last.
// So I will only replace the TOP part here, and DELETE the bottom `Serve Frontend` block in a separate call.


// -------------------- LiveKit Token API --------------------
app.post("/api/livekit/token", async (req, res) => {
  const { userName, roomName } = req.body;


  try {
    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL)
      return res.status(500).json({ error: "LiveKit configuration missing" });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userName,
      ttl: "1h",
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    console.log(`🎟️ Token generated for ${userName} | Room: ${roomName}`);
    return res.json({ token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("❌ LiveKit token error:", err);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// -------------------- Socket.IO + Deepgram --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});


let onlineUsers = {};
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Map roomName -> registerNumber for active calls
const roomToRegister = {};

async function getNextRegisterNumber() {
  const doc = await CounterModel.findOneAndUpdate(
    { name: "registerNumber" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const n = doc.seq;
  const str = String(n);
  return str.length < 3 ? str.padStart(3, "0") : str; // 001..999 then 1000+
}

// Text-based language detection using franc (fallback for Indian languages)
async function detectLanguageFromText(text) {
  if (!text || !text.trim() || text.trim().length < 3) return "unknown";
  try {
    // Dynamic import for CommonJS compatibility
    const francModule = await import("franc");
    const francFunc = francModule.default || francModule.franc || francModule;
    const detected = francFunc(text.trim());
    // Map franc codes to ISO 639-1 where possible
    const langMap = {
      "hin": "hi", // Hindi
      "ben": "bn", // Bengali
      "tam": "ta", // Tamil
      "tel": "te", // Telugu
      "mal": "ml", // Malayalam
      "mar": "mr", // Marathi
      "guj": "gu", // Gujarati
      "kan": "kn", // Kannada
      "pan": "pa", // Punjabi
      "urd": "ur", // Urdu
      "eng": "en", // English
    };
    return langMap[detected] || detected || "unknown";
  } catch (e) {
    console.warn("⚠️ Franc detection error:", e);
    return "unknown";
  }
}

// Optional Whisper fallback (requires OPENAI_API_KEY)
async function transcribeWithWhisper(buffer, mimeType) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const endpoint = "https://api.openai.com/v1/audio/transcriptions";
    const blob = new Blob([buffer], { type: mimeType || "audio/webm" });
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("file", blob, "audio." + (mimeType?.split("/")[1] || "webm"));
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("❌ Whisper API error:", res.status, errText);
      return null;
    }
    const data = await res.json();
    // verbose_json includes text and language (ISO 639-1 where possible)
    return { text: data?.text || "", language: data?.language || "unknown" };
  } catch (e) {
    console.error("❌ Whisper fallback error:", e);
    return null;
  }
}

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("register-user", ({ userId, userName }) => {
    if (!userId || !userName) return;
    onlineUsers[userId] = { socketId: socket.id, userName };
    console.log(`✅ Registered: ${userName} (${userId})`);
  });

  // 🔹 Call events
  socket.on("call-user", ({ toUserId, fromUserId, roomName }) => {
    const callee = onlineUsers[toUserId];
    const caller = onlineUsers[fromUserId];
    if (callee && caller) {
      // Create a registerNumber for this call if not exists
      (async () => {
        try {
          if (!roomToRegister[roomName]) {
            const registerNumber = await getNextRegisterNumber();
            roomToRegister[roomName] = registerNumber;
            await CallModel.create({
              registerNumber,
              roomName,
              participants: [caller.userName, callee.userName],
            });
            console.log(`#️⃣ Call ${roomName} -> register ${registerNumber}`);
          }
        } catch (e) {
          console.error("❌ Failed to create call register:", e);
        }
      })();
      io.to(callee.socketId).emit("incoming-call", {
        fromUserId,
        fromUserName: caller.userName,
        roomName,
      });
      console.log(`📞 ${caller.userName} is calling ${callee.userName}`);
    }
  });

  socket.on("call-response", ({ toUserId, accepted, roomName }) => {
    const caller = onlineUsers[toUserId];
    if (caller) {
      io.to(caller.socketId).emit("call-response", { accepted, roomName });
      console.log(`📲 Call ${accepted ? "accepted ✅" : "rejected ❌"} for ${roomName}`);
    }
  });

  // ✅ Deepgram Audio Transcription (accepts binary or base64)
  socket.on("audio-stream", async ({ audioBuffer, username, roomName, mimetype }) => {
    try {
      if (!audioBuffer || !username) return;
      // Reconstruct Buffer from multiple possible shapes sent over socket
      let buffer;
      if (Buffer.isBuffer(audioBuffer)) {
        buffer = audioBuffer;
      } else if (typeof audioBuffer === "string") {
        buffer = Buffer.from(audioBuffer, "base64");
      } else if (audioBuffer && typeof audioBuffer === "object") {
        if (ArrayBuffer.isView(audioBuffer)) {
          buffer = Buffer.from(audioBuffer.buffer);
        } else if (audioBuffer instanceof ArrayBuffer) {
          buffer = Buffer.from(new Uint8Array(audioBuffer));
        } else if (Array.isArray(audioBuffer.data)) {
          // Case: { type: 'Buffer', data: number[] }
          buffer = Buffer.from(audioBuffer.data);
        }
      }
      if (!buffer) {
        console.warn("⚠️ Unable to reconstruct audio buffer; skipping.");
        return;
      }
      console.log(`🔊 Received audio chunk ${buffer.length} bytes, mimetype: ${mimetype || "unknown"}`);
      const safeExt = mimetype && mimetype.includes("ogg") ? "ogg" : "webm";
      const tempFilePath = `temp_${Date.now()}.${safeExt}`;
      fs.writeFileSync(tempFilePath, buffer);

      const dgMime = (mimetype || `audio/${safeExt}`).split(";")[0];

      // Run Deepgram and Whisper in parallel (when OPENAI_API_KEY is present)
      const deepgramPromise = (async () => {
        try {
          const resp = await deepgram.listen.prerecorded.transcribeFile(
            fs.createReadStream(tempFilePath),
            {
              model: "nova-2",
              smart_format: true,
              detect_language: true,
              punctuate: true,
              mimetype: dgMime,
              alternate_languages: [
                "en", "hi", "bn", "ta", "te", "ml", "mr", "gu", "kn", "pa", "ur",
              ],
              keywords: [
                "bharat", "bhargav", "mumbai", "delhi", "bengaluru", "hyderabad", "chennai", "kolkata", "ahmedabad", "pune",
              ],
            }
          );
          const root = resp?.results || resp?.result?.results;
          const text = root?.channels?.[0]?.alternatives?.[0]?.transcript || "";
          const lang = root?.channels?.[0]?.detected_language || "unknown";
          return { text, lang, engine: "deepgram", debugRoot: !!root };
        } catch (e) {
          console.error("❌ Deepgram error:", e);
          return { text: "", lang: "unknown", engine: "deepgram" };
        }
      })();

      const whisperPromise = transcribeWithWhisper(buffer, dgMime);
      const [dgResult, whisperResult] = await Promise.allSettled([deepgramPromise, whisperPromise]);

      fs.unlinkSync(tempFilePath);

      const dg = dgResult.status === "fulfilled" ? dgResult.value : null;
      const wh = whisperResult.status === "fulfilled" ? whisperResult.value : null;

      // Choose the best available transcript
      const finalText = (dg?.text && dg.text.trim()) ? dg.text : ((wh?.text && wh.text.trim()) ? wh.text : "");
      let finalLang = (dg?.text && dg.text.trim() && dg?.lang && dg.lang !== "unknown")
        ? dg.lang
        : (wh?.language || dg?.lang || "unknown");


      // Use franc as secondary detector if language is still unknown
      if (finalText && (finalLang === "unknown" || !finalLang)) {
        const francLang = await detectLanguageFromText(finalText);
        if (francLang && francLang !== "unknown") {
          finalLang = francLang;
          console.log(`🔍 Franc detected language: ${finalLang}`);
        }
      }


      const engineUsed = (dg?.text && dg.text.trim()) ? "Deepgram" : ((wh?.text && wh.text.trim()) ? "Whisper" : "none");

      if (finalText) {
        const speechDoc = new SpeechModel({
          username,
          transcription: finalText,
          language: finalLang || "unknown",
          roomName,
          registerNumber: roomToRegister[roomName],
        });
        await speechDoc.save();
        console.log(`💾 Saved (${engineUsed}): ${username} (${finalLang || "unknown"}) [${roomToRegister[roomName] || "no-reg"}] -> ${finalText}`);
      } else {
        console.log("⚠️ No speech detected after both engines, skipping save.");
      }
    } catch (err) {
      console.error("❌ Error transcribing audio:", err);
    }
  });

  socket.on("disconnect", () => {
    for (let uid in onlineUsers) {
      if (onlineUsers[uid].socketId === socket.id) {
        console.log(`🔴 Disconnected: ${onlineUsers[uid].userName}`);
        delete onlineUsers[uid];
        break;
      }
    }
  });
});

// -------------------- Catch-All (SPA) --------------------
// Ensure this matches the variable defined at the top
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

// -------------------- Start Server --------------------
const startServer = (port) => {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} is busy, trying ${port + 1}...`);
      server.close(); // Close the failed instance just in case
      server.removeAllListeners('error'); // Remove this listener to avoid stacking
      startServer(port + 1); // Retry with new port
    } else {
      console.error("❌ Server error:", err);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
};

const PORT = parseInt(process.env.PORT || 5000, 10);
startServer(PORT);
