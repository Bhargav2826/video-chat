import express from "express";
import Message from "../models/Message.js";

const router = express.Router();

// Get conversation between two users
router.get("/history/:user1Id/:user2Id", async (req, res) => {
    try {
        const { user1Id, user2Id } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: user1Id, receiver: user2Id },
                { sender: user2Id, receiver: user1Id }
            ]
        }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
});

export default router;
