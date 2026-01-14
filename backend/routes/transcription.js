import express from "express";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import { createClient } from "@deepgram/sdk";
import SpeechModel from "../models/Speech.js";

dotenv.config();

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// ✅ POST route for transcribing audio
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const { username } = req.body;
    const audioFile = req.file;

    if (!audioFile) return res.status(400).json({ error: "No audio file uploaded" });
    if (!username) return res.status(400).json({ error: "Username is required" });

    const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
    if (!DEEPGRAM_KEY)
      return res.status(500).json({ error: "DEEPGRAM_API_KEY missing in .env" });

    console.log("🎧 Transcribing with Deepgram v3...");

    const deepgram = createClient(DEEPGRAM_KEY);
    const audioBuffer = fs.readFileSync(audioFile.path);

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
      model: "nova-2",
      smart_format: true,
      punctuate: true,
      mimetype: audioFile.mimetype,
    });

    // Delete temp file
    fs.unlinkSync(audioFile.path);

    if (error) {
      console.error("🛑 Deepgram error:", error);
      throw new Error(error.message || "Deepgram transcription error");
    }

    const transcript =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    if (!transcript.trim()) {
      return res.status(400).json({
        error: "Empty transcript received from Deepgram",
        debug: result,
      });
    }

    const language = result?.results?.channels?.[0]?.detected_language || "en";

    const speechDoc = new SpeechModel({
      username: username,
      language,
      transcription: transcript,
    });

    await speechDoc.save();

    res.json({
      success: true,
      text: transcript,
      language,
      id: speechDoc._id,
    });
  } catch (err) {
    console.error("❌ Deepgram Transcription Error:", err);
    res.status(500).json({
      error: "Transcription failed",
      details: err.message || err,
    });
  }
});

export default router;
