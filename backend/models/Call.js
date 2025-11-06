import mongoose from "mongoose";

const callSchema = new mongoose.Schema({
  registerNumber: { type: String, required: true, unique: true },
  roomName: { type: String, required: true },
  participants: [{ type: String }], // usernames
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Call", callSchema);


