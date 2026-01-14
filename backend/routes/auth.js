import express from "express";
import Student from "../models/Student.js";
import Faculty from "../models/Faculty.js";
import Parent from "../models/Parent.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

const getModelByRole = (role) => {
  if (role === "faculty") return Faculty;
  if (role === "parent") return Parent;
  return Student;
};

// --------------------
// Register new user
// --------------------
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if email exists in ANY collection
    const checkEmail = async (email) => {
      const s = await Student.findOne({ email });
      const f = await Faculty.findOne({ email });
      const p = await Parent.findOne({ email });
      return s || f || p;
    };

    const existing = await checkEmail(email);
    if (existing) return res.status(400).json({ error: "Email already registered in the system" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const Model = getModelByRole(role);
    const newUser = new Model({ username, email, password: hashedPassword, role: role || "student" });
    const user = await newUser.save();

    res.status(201).json({ message: `${role || "student"} registered successfully`, user });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// --------------------
// Login user
// --------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Search across all collections
    let user = await Student.findOne({ email });
    if (!user) user = await Faculty.findOne({ email });
    if (!user) user = await Parent.findOne({ email });

    if (!user) return res.status(400).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Wrong password" });

    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET is not defined!");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "111h" }
    );

    res.json({ token, username: user.username, id: user._id, role: user.role });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// --------------------
// Get all users (aggregated)
// --------------------
router.get("/all-users", async (req, res) => {
  try {
    const students = await Student.find({}, "username email role");
    const faculty = await Faculty.find({}, "username email role");
    const parents = await Parent.find({}, "username email role");

    const allUsers = [...students, ...faculty, ...parents];
    res.json(allUsers);
  } catch (err) {
    console.error("❌ Fetch users error:", err);
    res.status(500).json("Server error");
  }
});

export default router;
