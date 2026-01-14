import mongoose from "mongoose";

const FacultySchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        role: { type: String, default: "faculty" },
    },
    { timestamps: true }
);

export default mongoose.model("Faculty", FacultySchema);
