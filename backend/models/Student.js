import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        role: { type: String, default: "student" },
        studentId: { type: String, unique: true },
    },
    { timestamps: true }
);

export default mongoose.model("Student", StudentSchema);
