import mongoose from "mongoose";

const speechSchema = new mongoose.Schema({
  username: { type: String, required: true },
  transcription: { type: String, required: true },
  language: { type: String, default: "unknown" },
  roomName: { type: String },
  registerNumber: { type: String },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model("Speech", speechSchema);
