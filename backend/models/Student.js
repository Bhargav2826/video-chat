import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        role: { type: String, default: "student" },
    },
    { timestamps: true }
);

export default mongoose.model("Student", StudentSchema);
