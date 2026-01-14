import mongoose from "mongoose";

const ParentSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        role: { type: String, default: "parent" },
    },
    { timestamps: true }
);

export default mongoose.model("Parent", ParentSchema);
