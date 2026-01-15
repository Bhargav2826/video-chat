import mongoose from "mongoose";

const callSchema = new mongoose.Schema({
  registerNumber: { type: String, required: true, unique: true },
  roomName: { type: String, required: true },
  participants: [{ type: String }], // usernames
  participantIds: [{ type: mongoose.Schema.Types.ObjectId }], // ObjectIds for easy lookup
  type: { type: String, enum: ["video", "voice"], default: "video" },
  status: { type: String, enum: ["missed", "completed", "active"], default: "active" },
  duration: { type: Number, default: 0 }, // in seconds
  endedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model("Call", callSchema);
