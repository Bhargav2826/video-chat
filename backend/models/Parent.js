import mongoose from "mongoose";

const ParentSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        role: { type: String, default: "parent" },
        linkedStudentIds: [{ type: String }], // Array of studentId strings
    },
    { timestamps: true }
);

export default mongoose.model("Parent", ParentSchema);
