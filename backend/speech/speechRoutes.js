import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import SpeechModel from "../models/Speech.js";

const getFullLanguageName = (code) => {
  if (!code || code === "unknown") return "unknown";
  const names = {
    "en": "English", "hi": "Hindi", "gu": "Gujarati", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "ml": "Malayalam", "mr": "Marathi",
    "kn": "Kannada", "pa": "Punjabi", "ur": "Urdu"
  };
  return names[code.toLowerCase()] || code;
};

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// POST /api/speech/transcribe
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const audioFile = fs.createReadStream(req.file.path);
    const username = req.body.username || "Unknown User";

    // Send to Deepgram with language detection
    const response = await fetch("https://api.deepgram.com/v1/listen?detect_language=true", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      },
      body: audioFile,
    });

    const data = await response.json();
    fs.unlinkSync(req.file.path); // cleanup uploaded file

    const result = data?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = result?.transcript?.trim();
    const language = result?.language || "unknown";

    if (!transcript) {
      return res.status(400).json({ error: "No speech detected" });
    }

    // Save to MongoDB Atlas
    const fullLanguage = getFullLanguageName(language);
    const newSpeech = new SpeechModel({
      username,
      transcription: transcript,
      language: fullLanguage,
    });
    await newSpeech.save();

    res.status(200).json({
      success: true,
      username,
      text: transcript,
      language: fullLanguage,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({
      error: "Transcription failed",
      details: error.message,
    });
  }
});

// GET /api/speech/all — fetch all transcriptions
router.get("/all", async (req, res) => {
  try {
    const allTranscripts = await SpeechModel.find().sort({ timestamp: -1 });
    res.json(allTranscripts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transcripts" });
  }
});

export default router;
