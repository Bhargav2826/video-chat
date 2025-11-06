const mongoose = require("mongoose");

const transcriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roomName: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      default: "unknown",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transcription", transcriptionSchema);
