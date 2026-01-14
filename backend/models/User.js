import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "faculty", "parent"], default: "student" },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
