import express from "express";
import Student from "../models/Student.js";
import Faculty from "../models/Faculty.js";
import Parent from "../models/Parent.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Counter from "../models/Counter.js";

const router = express.Router();

const getModelByRole = (role) => {
  if (role === "faculty") return Faculty;
  if (role === "parent") return Parent;
  return Student;
};

const generateUniqueStudentId = async () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let isUnique = false;
  let newId = "";

  while (!isUnique) {
    const randomLetter = letters.charAt(Math.floor(Math.random() * letters.length));
    const randomDigits = Math.floor(1000 + Math.random() * 9000); // 4 digits
    newId = `${randomLetter}${randomDigits}`;

    // Check if this ID already exists
    const existing = await Student.findOne({ studentId: newId });
    if (!existing) isUnique = true;
  }
  return newId;
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
    let studentId = undefined;

    if (role === "student") {
      studentId = await generateUniqueStudentId();
    }

    const newUser = new Model({
      username,
      email,
      password: hashedPassword,
      role: role || "student",
      studentId
    });
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
    if (!user) {
      user = await Faculty.findOne({ email });
    }
    if (!user) {
      user = await Parent.findOne({ email });
    }

    if (!user) return res.status(400).json({ error: "User not found" });

    // Handle existing students without studentId or with old 'S' format
    if (user.role === "student") {
      const isOldFormat = user.studentId && user.studentId.startsWith('S') && user.studentId.length === 5;
      // ONLY assign a new ID if they don't have one AT ALL or if they have the old 'S0000' format
      if (!user.studentId || isOldFormat) {
        user.studentId = await generateUniqueStudentId();
        await user.save();
      }
      // Once they have a random ID (e.g. K9382), this block is skipped on subsequent logins, 
      // ensuring the ID is for a lifetime.
    }

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

    res.json({
      token,
      username: user.username,
      id: user._id,
      role: user.role,
      studentId: user.studentId
    });
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
