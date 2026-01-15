import express from "express";
import Message from "../models/Message.js";
import Student from "../models/Student.js";
import Faculty from "../models/Faculty.js";
import Call from "../models/Call.js";

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

// Find child by Student ID
router.get("/child/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const student = await Student.findOne({ studentId });
        if (!student) return res.status(404).json({ error: "Student not found" });
        res.json(student);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// Get list of faculty interactions for a student
router.get("/interactions/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const messages = await Message.find({
            $or: [{ sender: studentId }, { receiver: studentId }]
        });
        const facultyIds = new Set();
        messages.forEach(msg => {
            if (msg.sender.toString() !== studentId.toString()) facultyIds.add(msg.sender.toString());
            if (msg.receiver.toString() !== studentId.toString()) facultyIds.add(msg.receiver.toString());
        });
        const facultyList = await Faculty.find({ _id: { $in: Array.from(facultyIds) } }, "username _id");
        res.json(facultyList);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch interactions" });
    }
});

// Get flagged messages for a student
router.get("/flagged/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const flaggedMessages = await Message.find({
            $or: [{ sender: studentId }, { receiver: studentId }],
            flagged: true
        }).sort({ createdAt: -1 });
        res.json(flaggedMessages);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch flagged messages" });
    }
});

// Get call history for a student
router.get("/calls/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const calls = await Call.find({
            participantIds: studentId
        }).sort({ createdAt: -1 });
        res.json(calls);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch call history" });
    }
});

// Check if student is currently in an active call
router.get("/active-call/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const activeCall = await Call.findOne({
            participantIds: studentId,
            status: "active"
        });
        res.json({ active: !!activeCall, call: activeCall });
    } catch (err) {
        res.status(500).json({ error: "Failed to check active status" });
    }
});

// Get Weekly Safety Summary
router.get("/summary/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const [messages, calls, flagged] = await Promise.all([
            Message.countDocuments({
                $or: [{ sender: studentId }, { receiver: studentId }],
                createdAt: { $gte: oneWeekAgo }
            }),
            Call.countDocuments({
                participantIds: studentId,
                createdAt: { $gte: oneWeekAgo }
            }),
            Message.countDocuments({
                $or: [{ sender: studentId }, { receiver: studentId }],
                flagged: true,
                createdAt: { $gte: oneWeekAgo }
            })
        ]);

        res.json({
            totalMessages: messages,
            totalCalls: calls,
            flaggedCount: flagged,
            period: "Last 7 Days",
            status: flagged > 0 ? "Attention Required" : "Secure"
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate summary" });
    }
});

export default router;
