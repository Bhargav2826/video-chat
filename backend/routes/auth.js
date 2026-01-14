import express from "express";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

// --------------------
// Register new user
// --------------------
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ username, email, password: hashedPassword, role: role || "student" });
    const user = await newUser.save();
    res.status(201).json({ message: "User registered", user });
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
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Wrong password" });

    // Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET is not defined in environment variables!");
      return res.status(500).json({ error: "Server configuration error: JWT_SECRET missing" });
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
// Get all users
// --------------------
router.get("/all-users", async (req, res) => {
  try {
    const users = await User.find({}, "username email");
    res.json(users);
  } catch (err) {
    console.error("❌ Fetch users error:", err);
    res.status(500).json("Server error");
  }
});

export default router;
