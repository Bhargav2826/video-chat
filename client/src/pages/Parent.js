import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import "bootstrap-icons/font/bootstrap-icons.css";

const socket = io("/", { autoConnect: true });

function Parent() {
    const navigate = useNavigate();
    const username = localStorage.getItem("username") || "Guest";
    const userId = localStorage.getItem("userId");
    const role = localStorage.getItem("role");

    // Monitoring State
    const [searchId, setSearchId] = useState("");
    const [child, setChild] = useState(null);
    const [faculties, setFaculties] = useState([]);
    const [selectedFaculty, setSelectedFaculty] = useState(null);
    const [messages, setMessages] = useState([]);
    const [flaggedMessages, setFlaggedMessages] = useState([]);
    const [callHistory, setCallHistory] = useState([]);
    const [activeCall, setActiveCall] = useState(null);
    const [safetySummary, setSafetySummary] = useState(null);
    const [liveCaptions, setLiveCaptions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("chat"); // chat, safety, calls, report
    const [chatSearch, setChatSearch] = useState("");

    // Child Linking State
    const [linkedStudentIds, setLinkedStudentIds] = useState([]);
    const [linkedStudents, setLinkedStudents] = useState([]); // [{ studentId, username }]
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkInputId, setLinkInputId] = useState("");
    const [linkMessage, setLinkMessage] = useState("");

    // Refs for smooth scrolling
    const chatEndRef = useRef(null);

    useEffect(() => {
        if (role !== "parent") {
            navigate("/login");
            return;
        }
        const savedIds = localStorage.getItem("linkedStudentIds");
        if (savedIds) {
            const ids = JSON.parse(savedIds);
            setLinkedStudentIds(ids);
            fetchStudentNames(ids);
        }
    }, [role, navigate]);

    const fetchStudentNames = async (ids) => {
        if (!ids || ids.length === 0) return;
        try {
            const res = await axios.post("/api/auth/get-student-names", { studentIds: ids });
            setLinkedStudents(res.data);
        } catch (err) {
            console.error("Failed to fetch student names:", err);
        }
    };

    // Handle Socket Transcriptions
    useEffect(() => {
        socket.on("new-transcription", (data) => {
            setLiveCaptions(prev => [...prev, data].slice(-15));
        });
        return () => socket.off("new-transcription");
    }, []);

    // Join room for live monitoring when a call is active
    useEffect(() => {
        if (activeCall?.roomName) {
            socket.emit("join-room", activeCall.roomName);
        }
    }, [activeCall]);

    // Polling for active status
    useEffect(() => {
        let interval;
        if (child) {
            const checkStatus = async () => {
                try {
                    const res = await axios.get(`/api/messages/active-call/${child._id}`, {
                        headers: { "x-parent-id": userId }
                    });
                    const newActiveCall = res.data.active ? res.data.call : null;
                    setActiveCall(newActiveCall);
                    if (!newActiveCall) setLiveCaptions([]);
                } catch (err) {
                    console.error("Status check failed");
                }
            };
            checkStatus();
            interval = setInterval(checkStatus, 5000);
        }
        return () => clearInterval(interval);
    }, [child, userId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, liveCaptions]);

    const handleLinkChild = async (e) => {
        if (e) e.preventDefault();
        setLinkMessage("");
        if (!linkInputId.trim()) return;

        try {
            const res = await axios.post("/api/auth/link-child", {
                parentId: userId,
                studentId: linkInputId.trim()
            });
            const newIds = res.data.linkedStudentIds;
            setLinkedStudentIds(newIds);
            localStorage.setItem("linkedStudentIds", JSON.stringify(newIds));

            // Update linked students with name
            setLinkedStudents(prev => [...prev, { studentId: linkInputId.trim(), username: res.data.studentName }]);

            setLinkMessage("Child linked successfully!");
            setLinkInputId("");
            setTimeout(() => {
                setShowLinkModal(false);
                setLinkMessage("");
            }, 1500);
        } catch (err) {
            setLinkMessage(err.response?.data?.error || "Linking failed.");
        }
    };

    const handleSearch = async (tid) => {
        if (!tid) return;

        // Security Check: Role-Locked Access
        if (!linkedStudentIds.includes(tid)) {
            setError("Unauthorized access. You can only monitor your linked children.");
            return;
        }

        setIsLoading(true);
        setError("");
        setChild(null);
        setFaculties([]);
        setMessages([]);
        setSelectedFaculty(null);
        setLiveCaptions([]);

        try {
            const studentRes = await axios.get(`/api/messages/child/${tid}`, {
                headers: { "x-parent-id": userId }
            });
            const studentData = studentRes.data;
            setChild(studentData);

            const config = { headers: { "x-parent-id": userId } };
            const [interactions, flagged, calls, summary] = await Promise.all([
                axios.get(`/api/messages/interactions/${studentData._id}`, config),
                axios.get(`/api/messages/flagged/${studentData._id}`, config),
                axios.get(`/api/messages/calls/${studentData._id}`, config),
                axios.get(`/api/messages/summary/${studentData._id}`, config)
            ]);

            setFaculties(interactions.data);
            setFlaggedMessages(flagged.data);
            setCallHistory(calls.data);
            setSafetySummary(summary.data);

        } catch (err) {
            setError(err.response?.data?.error || "Student not found or lookup failed.");
        } finally {
            setIsLoading(false);
        }
    };

    const fetchChatHistory = async (faculty) => {
        if (!child || !faculty) return;
        setIsLoading(true);
        setSelectedFaculty(faculty);
        try {
            const res = await axios.get(`/api/messages/history/${child._id}/${faculty._id}`, {
                headers: { "x-parent-id": userId }
            });
            setMessages(res.data);
            setActiveTab("chat");
        } catch (err) {
            setError("Failed to fetch chat history.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        navigate("/login");
    };

    const groupedMessages = messages
        .filter(m => m.text.toLowerCase().includes(chatSearch.toLowerCase()))
        .reduce((groups, msg) => {
            const date = new Date(msg.timestamp).toLocaleDateString([], {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            if (!groups[date]) groups[date] = [];
            groups[date].push(msg);
            return groups;
        }, {});

    const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    return (
        <div className="h-screen flex flex-col bg-gray-50 text-gray-950 overflow-hidden font-sans antialiased">
            {/* Unified Navbar - Aligned with Student/Faculty */}
            <nav className="flex items-center justify-between px-8 py-5 bg-white border-b border-gray-100 shadow-md z-50">
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setChild(null)}>
                    <div className="bg-blue-600 p-2 rounded-lg">
                        <i className="bi bi-shield-lock-fill text-white text-xl"></i>
                    </div>
                    <span className="text-xl font-black tracking-tighter text-blue-900 uppercase">COCOON <span className="text-gray-400">GUARDIAN PORTAL</span></span>
                </div>

                <div className="flex items-center gap-6">
                    {child && (
                        <div className={`px-5 py-2.5 rounded-2xl flex items-center gap-3 border transition-all duration-500 ${activeCall
                            ? "bg-red-50 border-red-100 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                            : "bg-green-50 border-green-100"}`}>
                            <div className={`w-2 h-2 rounded-full ${activeCall ? "bg-red-500 animate-pulse" : "bg-green-500"}`}></div>
                            <span className={`text-[10px] font-black uppercase tracking-widest ${activeCall ? "text-red-700" : "text-green-700"}`}>
                                {activeCall ? "Live Audio Streaming" : "System Secure"}
                            </span>
                        </div>
                    )}
                    <div className="h-8 w-[1px] bg-gray-200"></div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-2xl border border-gray-200">
                            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                            <span className="text-sm font-bold text-gray-800">{username}</span>
                        </div>
                        <button onClick={handleLogout} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-bold transition-all border border-gray-200">
                            Logout
                        </button>
                    </div>
                </div>
            </nav>

            <div className="flex-grow flex flex-col overflow-y-auto custom-scrollbar">

                {/* Centered Hub Layout */}
                <div className="max-w-6xl mx-auto w-full px-8 py-10 space-y-12">

                    {!child ? (
                        <div className="text-center space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">
                            <div className="relative inline-block">
                                <div className="absolute inset-0 bg-blue-600/10 blur-3xl animate-pulse"></div>
                                <div className="relative w-32 h-32 bg-white border border-gray-100 rounded-[2.5rem] shadow-xl flex items-center justify-center mx-auto">
                                    <i className="bi bi-shield-shaded text-5xl text-blue-600"></i>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <h1 className="text-5xl font-black text-gray-800 tracking-tighter">Welcome to <span className="text-blue-600">Cocoon Guardian</span></h1>
                                <p className="text-gray-500 font-medium max-w-lg mx-auto text-xl leading-relaxed">Select a verified student identity to begin real-time monitoring and safety verification.</p>
                            </div>

                            {/* Identity Actions Hub */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all text-left space-y-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                                            <i className="bi bi-search text-blue-600 text-xl"></i>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-black text-gray-800">Access Identity</span>
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Authorized Lookup</span>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            className="w-full pl-6 pr-24 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-semibold text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                            placeholder="Enter Student ID (e.g. S102)..."
                                            value={searchId}
                                            onChange={e => setSearchId(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSearch(searchId)}
                                        />
                                        <button
                                            onClick={() => handleSearch(searchId)}
                                            className="absolute right-2 top-2 bottom-2 px-6 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-600/20"
                                        >
                                            Lookup
                                        </button>
                                    </div>
                                    {error && <p className="text-red-600 text-[10px] font-black uppercase tracking-widest px-1"><i className="bi bi-exclamation-circle mr-2"></i>{error}</p>}
                                </div>

                                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all text-left space-y-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                                            <i className="bi bi-link-45deg text-indigo-600 text-2xl"></i>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-black text-gray-800">Verify New Child</span>
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Secure Linkage</span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-500 leading-relaxed font-medium">Add a new verified student ID to your monitoring vault to access their safety logs and interactions.</p>
                                    <button
                                        onClick={() => setShowLinkModal(true)}
                                        className="w-full py-4 bg-indigo-50 text-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-indigo-100 hover:bg-indigo-100 transition-all"
                                    >
                                        Initiate Verification
                                    </button>
                                </div>
                            </div>

                            {/* Linked Accounts Grid */}
                            {linkedStudentIds.length > 0 && (
                                <div className="space-y-6 max-w-4xl mx-auto pt-8">
                                    <div className="flex items-center justify-between px-2">
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Authorized Vault</h3>
                                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg uppercase">{linkedStudentIds.length} Identity Found</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                        {linkedStudents.map(student => (
                                            <button
                                                key={student.studentId}
                                                onClick={() => handleSearch(student.studentId)}
                                                className="group flex items-center gap-4 p-5 bg-white border border-gray-100 rounded-3xl hover:border-blue-500/30 hover:shadow-md transition-all text-left"
                                            >
                                                <div className="w-11 h-11 rounded-2xl bg-gray-50 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-sm font-black text-gray-400 transition-all uppercase">
                                                    {student.username.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-800">{student.username}</span>
                                                    <span className="text-[9px] font-black text-gray-400 uppercase">Verified Student Identity</span>
                                                </div>
                                                <i className="bi bi-chevron-right ml-auto text-gray-200 group-hover:text-blue-500 transition-colors"></i>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">

                            {/* Student Control Bar */}
                            <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-5">
                                    <button onClick={() => setChild(null)} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all border border-gray-100">
                                        <i className="bi bi-arrow-left"></i>
                                    </button>
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-tr from-blue-600 to-blue-400 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-blue-600/30">
                                            {child.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-gray-800">{child.username}</h2>
                                            <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                                                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                                                SECURE MONITORING ACTIVE: {activeCall ? "STREAMING" : "IDLE"}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2 p-1.5 bg-gray-50 rounded-2xl border border-gray-100">
                                    {[
                                        { id: "chat", icon: "bi-chat-heart", label: "Logs" },
                                        { id: "safety", icon: "bi-shield-exclamation", label: "Flags" },
                                        { id: "calls", icon: "bi-earpods", label: "History" },
                                        { id: "report", icon: "bi-clipboard-pulse", label: "Insight" }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === tab.id
                                                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                                                : "text-gray-400 hover:text-gray-600"}`}
                                        >
                                            <i className={tab.icon}></i>
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* LIVE MONITORING BAR */}
                            {activeCall && (
                                <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 flex items-center gap-8 shadow-sm">
                                    <div className="flex-shrink-0 flex items-center gap-3 bg-red-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-red-600/30">
                                        <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                                        Listening
                                    </div>
                                    <div className="flex-grow overflow-hidden relative h-8 flex items-center">
                                        <div className={`flex gap-6 whitespace-nowrap ${liveCaptions.length > 0 ? "animate-marquee-slow" : ""}`}>
                                            {liveCaptions.length === 0 ? (
                                                <span className="text-red-400 text-[10px] font-black uppercase tracking-widest italic">Scanning audio frequencies...</span>
                                            ) : (
                                                liveCaptions.map((cap, i) => (
                                                    <div key={i} className="flex items-center gap-3 bg-white/50 px-4 py-2 rounded-lg border border-red-100">
                                                        <span className="text-red-700 font-black text-xs">"{cap.text}"</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                    <button onClick={() => setActiveTab("calls")} className="text-[10px] font-black uppercase text-red-600 border border-red-200 px-5 py-2 rounded-xl hover:bg-red-100 transition-all">Inspect View</button>
                                </div>
                            )}

                            {/* MAIN DYNAMIC CONTENT */}
                            <div className="space-y-10 min-h-[600px]">

                                {activeTab === "chat" && (
                                    <div className="space-y-4">
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Faculty Members</h3>
                                        <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar no-scrollbar">
                                            {faculties.map(f => (
                                                <button
                                                    key={f._id}
                                                    onClick={() => fetchChatHistory(f)}
                                                    className={`flex-shrink-0 flex items-center gap-4 p-4 rounded-3xl border transition-all ${selectedFaculty?._id === f._id
                                                        ? "bg-white border-blue-500/30 shadow-md ring-4 ring-blue-600/5 text-blue-600"
                                                        : "bg-white/50 border-gray-100 hover:bg-white text-gray-500"}`}
                                                >
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm ${selectedFaculty?._id === f._id ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "bg-blue-100 text-blue-600"}`}>
                                                        {f.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex flex-col text-left pr-4">
                                                        <span className="text-sm font-black text-gray-800">{f.username}</span>
                                                        <span className={`text-[9px] font-black uppercase tracking-tight ${selectedFaculty?._id === f._id ? "text-blue-600" : "text-gray-400"}`}>Connected Faculty</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeTab === "chat" && (
                                    <div className="space-y-8">
                                        <div className="h-[1px] bg-gray-100 w-full"></div>
                                        <div className="space-y-4">
                                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Communication Logs</h3>
                                            <div className="max-w-4xl mx-auto w-full">
                                                {!selectedFaculty ? (
                                                    <div className="h-96 flex flex-col items-center justify-center text-center opacity-40 bg-white rounded-[2.5rem] border border-dashed border-gray-200">
                                                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                                            <i className="bi bi-chat-dots-fill text-3xl text-gray-300"></i>
                                                        </div>
                                                        <p className="font-black uppercase tracking-widest text-[10px]">Digital Archive Vault. Select a channel to audit.</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-16">
                                                        {Object.entries(groupedMessages).map(([date, msgs]) => (
                                                            <div key={date} className="space-y-10">
                                                                <div className="flex items-center gap-6">
                                                                    <div className="h-[1px] flex-grow bg-gray-200"></div>
                                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">{date}</span>
                                                                    <div className="h-[1px] flex-grow bg-gray-200"></div>
                                                                </div>
                                                                <div className="space-y-8 flex flex-col">
                                                                    {msgs.map((msg, i) => (
                                                                        <div key={i} className={`flex ${msg.sender === child._id ? "justify-end" : "justify-start"}`}>
                                                                            <div className={`max-w-[70%] space-y-2 flex flex-col`}>
                                                                                <div className={`px-5 py-3 rounded-[1.5rem] shadow-sm text-sm font-medium leading-relaxed ${msg.sender === child._id
                                                                                    ? "bg-blue-600 text-white rounded-tr-none self-end"
                                                                                    : "bg-white text-gray-800 rounded-tl-none border border-gray-100 self-start"}`}>
                                                                                    {msg.text}
                                                                                </div>
                                                                                <div className={`text-[9px] font-black uppercase tracking-tighter opacity-40 ${msg.sender === child._id ? "self-end mr-1" : "self-start ml-1"}`}>
                                                                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                                    {msg.flagged && <span className="text-red-600 ml-2"><i className="bi bi-shield-fill-exclamation mr-1"></i> FLAG DETECTED</span>}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        <div ref={chatEndRef}></div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "safety" && (
                                    <div className="space-y-8">
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Safety Verification</h3>
                                        <div className="max-w-4xl mx-auto w-full space-y-6">
                                            <div className="bg-red-50 p-8 rounded-[2.5rem] border border-red-100 flex items-center justify-between shadow-sm">
                                                <div className="flex flex-col gap-1">
                                                    <h2 className="text-2xl font-black text-gray-800 uppercase tracking-tighter">Safety Breaches</h2>
                                                    <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Autonomous Security Analysis</p>
                                                </div>
                                                <div className="bg-red-600 text-white px-6 py-2 rounded-xl font-black text-xs uppercase shadow-lg shadow-red-600/20">
                                                    {flaggedMessages.length} Incident{flaggedMessages.length !== 1 ? 's' : ''} Identified
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4">
                                                {flaggedMessages.length === 0 ? (
                                                    <div className="p-20 text-center opacity-10 flex flex-col items-center bg-white rounded-[3rem] border border-gray-100">
                                                        <i className="bi bi-shield-check text-9xl"></i>
                                                        <p className="text-xl font-black uppercase tracking-[0.3em] mt-8">System Secured</p>
                                                    </div>
                                                ) : (
                                                    flaggedMessages.map((msg, i) => (
                                                        <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:border-red-500/20 transition-all group">
                                                            <div className="flex items-center justify-between mb-6">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center">
                                                                        <i className="bi bi-bug-fill text-red-600 text-xl"></i>
                                                                    </div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-black text-gray-800 uppercase tracking-tight">{msg.flagReason}</span>
                                                                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">{new Date(msg.timestamp).toLocaleString()}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="bg-gray-50 p-6 rounded-2xl border-l-[6px] border-red-600">
                                                                <p className="text-base font-semibold text-gray-700 italic leading-relaxed">"{msg.text}"</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "calls" && (
                                    <div className="space-y-8">
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Interaction History</h3>
                                        <div className="max-w-4xl mx-auto w-full space-y-10">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                {callHistory.length === 0 ? (
                                                    <div className="col-span-full p-20 text-center opacity-40 bg-white rounded-[3rem] border border-gray-100">
                                                        <i className="bi bi-broadcast text-7xl mb-6 block text-gray-200"></i>
                                                        <p className="text-[10px] font-black uppercase tracking-widest">No previous sessions found</p>
                                                    </div>
                                                ) : (
                                                    callHistory.map((call, i) => (
                                                        <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-all">
                                                                <i className={`bi ${call.type === "video" ? "bi-camera-video" : "bi-mic"} text-6xl`}></i>
                                                            </div>
                                                            <div className="space-y-6">
                                                                <div className="flex items-center gap-4">
                                                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl shadow-lg ${call.type === "video" ? "bg-blue-600 text-white shadow-blue-600/20" : "bg-green-600 text-white shadow-green-600/20"}`}>
                                                                        <i className={`bi ${call.type === "video" ? "bi-play-circle-fill" : "bi-soundwave"}`}></i>
                                                                    </div>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-black text-gray-800 uppercase tracking-tight">{call.type} Call Session</span>
                                                                        <span className="text-[10px] font-black text-gray-400 uppercase">Duration: {formatDuration(call.duration || 0)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="bg-gray-100 px-5 py-3 rounded-xl inline-block text-[10px] font-black text-gray-500 uppercase tracking-widest border border-gray-200">
                                                                    {new Date(call.createdAt).toLocaleString()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "report" && (
                                    <div className="space-y-8">
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Executive Summary</h3>
                                        <div className="max-w-5xl mx-auto w-full space-y-12">
                                            <div className="bg-white p-12 rounded-[3.5rem] border border-gray-100 shadow-2xl relative overflow-hidden text-center space-y-8">
                                                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600"></div>
                                                <div className="w-24 h-24 bg-blue-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                                                    <i className="bi bi-graph-up-arrow text-3xl text-blue-600"></i>
                                                </div>
                                                <h2 className="text-4xl font-black text-gray-800 uppercase tracking-tighter">System Health Dashboard</h2>
                                                <p className="text-gray-500 max-w-lg mx-auto font-medium text-lg leading-relaxed">Verified system audit of all communication channels including live audio stream, archived logs, and flagged safety breaches.</p>

                                                <div className="flex items-center justify-center gap-20 pt-10">
                                                    {[
                                                        { label: "Archived Msgs", value: safetySummary?.totalMessages || 0, color: "blue" },
                                                        { label: "Call Sessions", value: safetySummary?.totalCalls || 0, color: "blue" },
                                                        { label: "Safety Flags", value: flaggedMessages.length, color: "red" }
                                                    ].map((s, i) => (
                                                        <div key={i} className="flex flex-col items-center gap-4">
                                                            <span className={`text-6xl font-black tracking-tighter ${s.color === "red" && s.value > 0 ? "text-red-600" : "text-gray-800"}`}>{s.value}</span>
                                                            <span className={`text-[11px] font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-lg ${s.color === "red" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>{s.label}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Link Modal - Aligned with Student/Faculty Modals */}
            {showLinkModal && (
                <div className="fixed inset-0 z-[100] bg-blue-900/20 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-white p-10 rounded-[3rem] border border-white w-full max-w-lg text-center shadow-[0_40px_100px_rgba(30,58,138,0.3)] transform scale-100 animate-in zoom-in-95 duration-300">
                        <div className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-[2rem] mx-auto mb-8 flex items-center justify-center text-4xl font-black text-white shadow-2xl shadow-blue-600/40">
                            <i className="bi bi-link-45deg"></i>
                        </div>
                        <h2 className="text-3xl font-black text-gray-800 mb-2 uppercase tracking-tighter">Link Identity</h2>
                        <p className="text-gray-400 font-black uppercase tracking-[0.2em] text-[10px] mb-10">Encrypted Guardian Validation</p>

                        <form onSubmit={handleLinkChild} className="space-y-8">
                            <div className="space-y-4">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest text-left ml-2">Student Identification ID</label>
                                <input
                                    className="w-full px-8 py-5 bg-gray-50 border border-gray-100 rounded-[2rem] text-sm font-black text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                    placeholder="e.g. S102"
                                    value={linkInputId}
                                    onChange={e => setLinkInputId(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            {linkMessage && (
                                <div className={`p-5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center animate-in slide-in-from-bottom-2 ${linkMessage.includes("success") ? "bg-green-50 text-green-600 border border-green-100" : "bg-red-50 text-red-600 border border-red-100"}`}>
                                    {linkMessage}
                                </div>
                            )}
                            <div className="flex gap-6">
                                <button type="submit" className="flex-grow py-5 bg-blue-600 text-white font-black rounded-3xl shadow-2xl shadow-blue-600/40 transition-all hover:bg-blue-500 active:scale-95 uppercase tracking-widest text-xs">Authorize Identity</button>
                                <button type="button" onClick={() => setShowLinkModal(false)} className="px-8 py-5 bg-gray-100 text-gray-500 font-black rounded-3xl transition-all hover:bg-gray-200 active:scale-95 uppercase tracking-widest text-xs">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes marquee-slow {
                    0% { transform: translateX(50%); }
                    100% { transform: translateX(-150%); }
                }
                .animate-marquee-slow {
                    display: inline-flex;
                    animation: marquee-slow 30s linear infinite;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.05);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.1);
                }
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                .shadow-3xl {
                    box-shadow: 0 40px 100px rgba(0,0,0,0.1);
                }
            `}</style>
        </div>
    );
}

export default Parent;
