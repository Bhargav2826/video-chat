const router = require("express").Router();
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Register
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username, email, password: hashedPassword });
        const user = await newUser.save();
        res.status(201).json(user);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json("User not found");

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json("Wrong password");

        const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, username: user.username });
    } catch (err) {
        res.status(500).json(err);
    }
});

// Get all registered users
router.get("/all-users", async (req, res) => {
    try {
      const users = await User.find({}, "username email"); // only get username & email
      res.json(users);
    } catch (err) {
      res.status(500).json(err);
    }
  });
  
module.exports = router;
