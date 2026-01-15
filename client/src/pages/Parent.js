import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import "bootstrap-icons/font/bootstrap-icons.css";

const socket = io("/", { autoConnect: true });

function Parent() {
    const navigate = useNavigate();
    const username = localStorage.getItem("username") || "Guest";
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

    useEffect(() => {
        if (role !== "parent") {
            navigate("/login");
            return;
        }
    }, [role, navigate]);

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
                    const res = await axios.get(`/api/messages/active-call/${child._id}`);
                    const newActiveCall = res.data.active ? res.data.call : null;
                    setActiveCall(newActiveCall);
                    if (!newActiveCall) setLiveCaptions([]);
                } catch (err) {
                    console.error("Status check failed");
                }
            };
            checkStatus();
            interval = setInterval(checkStatus, 5000); // Check every 5 seconds for live feel
        }
        return () => clearInterval(interval);
    }, [child]);

    const handleSearch = async (e) => {
        if (e) e.preventDefault();
        if (!searchId.trim()) return;

        setIsLoading(true);
        setError("");
        setChild(null);
        setFaculties([]);
        setMessages([]);
        setSelectedFaculty(null);
        setLiveCaptions([]);

        try {
            const studentRes = await axios.get(`/api/messages/child/${searchId.trim()}`);
            const studentData = studentRes.data;
            setChild(studentData);

            // Fetch initial monitoring data
            const [interactions, flagged, calls, summary] = await Promise.all([
                axios.get(`/api/messages/interactions/${studentData._id}`),
                axios.get(`/api/messages/flagged/${studentData._id}`),
                axios.get(`/api/messages/calls/${studentData._id}`),
                axios.get(`/api/messages/summary/${studentData._id}`)
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
            const res = await axios.get(`/api/messages/history/${child._id}/${faculty._id}`);
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
        <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
            {/* Navbar */}
            <nav className="flex items-center justify-between px-6 py-4 bg-white shadow-md z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg">
                        <i className="bi bi-shield-check text-white text-xl"></i>
                    </div>
                    <span className="text-xl font-black tracking-tighter text-blue-900 italic">COCOON <span className="text-gray-400">GUARDIAN V2.0</span></span>
                </div>
                <div className="flex items-center gap-4">
                    {child && (
                        <div className={`px-4 py-2 rounded-2xl flex items-center gap-3 border transition-all ${activeCall ? "bg-red-50 border-red-100 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "bg-green-50 border-green-100"}`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${activeCall ? "bg-red-500 animate-pulse" : "bg-green-500"}`}></div>
                            <span className={`text-[10px] font-black uppercase tracking-widest ${activeCall ? "text-red-700" : "text-green-700"}`}>
                                {activeCall ? "LIVE: IN SESSION" : "STATUS: IDLE"}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-2xl border border-gray-200">
                        <span className="text-sm font-bold text-gray-800">{username}</span>
                    </div>
                    <button onClick={handleLogout} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-bold transition-all">Logout</button>
                </div>
            </nav>

            <div className="flex-grow bg-gray-100 flex shadow-2xl overflow-hidden antialiased text-gray-900 border-none m-0">
                {/* Sidebar Navigation */}
                <aside className="bg-white border-r border-gray-100 w-80 hidden lg:flex flex-col shadow-sm">
                    <div className="p-6 border-b border-gray-100">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 text-center">Identity Lookup</h3>
                        <form onSubmit={handleSearch} className="relative">
                            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input
                                className="w-full pl-11 pr-4 py-4 bg-gray-50 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 placeholder-gray-400 transition-all font-semibold"
                                placeholder="Student ID (e.g. A2934)"
                                value={searchId}
                                onChange={e => setSearchId(e.target.value)}
                            />
                        </form>
                    </div>

                    <div className="flex-grow overflow-y-auto p-4 space-y-4">
                        {child ? (
                            <>
                                {/* Child Profile Summary */}
                                <div className="bg-gradient-to-br from-blue-600 to-blue-400 rounded-3xl p-6 text-white shadow-xl shadow-blue-600/20">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center font-black text-xl">
                                            {child.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="text-sm font-black">{child.username}</div>
                                            <div className="text-[10px] opacity-80 uppercase tracking-widest">{child.studentId}</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mt-4">
                                        <button onClick={() => setActiveTab("safety")} className={`py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${activeTab === "safety" ? "bg-white text-blue-600" : "bg-white/10 hover:bg-white/20"}`}>Flags: {flaggedMessages.length}</button>
                                        <button onClick={() => setActiveTab("calls")} className={`py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${activeTab === "calls" ? "bg-white text-blue-600" : "bg-white/10 hover:bg-white/20"}`}>History</button>
                                    </div>
                                    <button onClick={() => setActiveTab("report")} className={`w-full mt-2 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${activeTab === "report" ? "bg-white text-blue-600 shadow-lg" : "bg-white/20 hover:bg-white/30"}`}>
                                        <i className="bi bi-graph-up-arrow mr-2"></i> Safety Dashboard
                                    </button>
                                </div>

                                {/* Faculty List */}
                                <div>
                                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3 px-2">Monitored Channels</h3>
                                    <div className="space-y-1">
                                        {faculties.map(faculty => (
                                            <button
                                                key={faculty._id}
                                                onClick={() => fetchChatHistory(faculty)}
                                                className={`w-full flex items-center gap-4 px-4 py-4 transition-all rounded-2xl ${selectedFaculty?._id === faculty._id ? "bg-gray-100 border border-gray-200" : "hover:bg-gray-50 text-gray-600"}`}
                                            >
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${selectedFaculty?._id === faculty._id ? "bg-blue-600 text-white shadow-lg" : "bg-blue-50 text-blue-600"}`}>
                                                    {faculty.username.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="text-left min-w-0">
                                                    <div className="text-sm font-black text-gray-800 truncate">{faculty.username}</div>
                                                    <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Teaching Faculty</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 mt-20">
                                <i className="bi bi-shield-lock text-5xl mb-4"></i>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Restricted View</p>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-grow flex flex-col relative bg-gray-50 overflow-hidden">
                    {!child ? (
                        <div className="flex-grow flex flex-col items-center justify-center p-12 text-center text-gray-800">
                            <div className="w-48 h-48 bg-white rounded-[4rem] shadow-2xl flex items-center justify-center mb-12 border border-gray-100 group hover:scale-105 transition-all">
                                <i className="bi bi-shield-fill-check text-8xl text-blue-600"></i>
                            </div>
                            <h1 className="text-6xl font-black mb-6 tracking-tighter uppercase leading-[0.9]">Universal <br /><span className="text-blue-600 tracking-[-0.05em]">Safety Portal</span></h1>
                            <p className="text-gray-400 max-w-sm text-lg font-medium leading-relaxed italic border-l-4 border-blue-600 pl-6">Cocoon protects what matters most. Enter a Student ID to begin monitoring.</p>
                        </div>
                    ) : (
                        <div className="flex-grow flex flex-col h-full overflow-hidden">
                            {/* Dashboard Header Container */}
                            <header className="px-10 py-6 bg-white border-b border-gray-100 flex items-center justify-between shadow-sm z-[20]">
                                <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl">
                                    <button onClick={() => setActiveTab("chat")} className={`px-4 lg:px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "chat" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>Logs</button>
                                    <button onClick={() => setActiveTab("safety")} className={`px-4 lg:px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "safety" ? "bg-white text-red-600 shadow-sm" : "text-gray-400 hover:text-red-400"}`}>Safety Flags {flaggedMessages.length > 0 && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span>}</button>
                                    <button onClick={() => setActiveTab("calls")} className={`px-4 lg:px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "calls" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>Call History</button>
                                    <button onClick={() => setActiveTab("report")} className={`px-4 lg:px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "report" ? "bg-white text-green-600 shadow-sm" : "text-gray-400 hover:text-green-600"}`}>Summary</button>
                                </div>
                                <div className="flex items-center gap-4">
                                    {(activeTab === "chat" && selectedFaculty) && (
                                        <div className="relative">
                                            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                                            <input
                                                className="pl-10 pr-4 py-2.5 bg-gray-50 rounded-xl text-[10px] font-bold focus:outline-none border border-transparent focus:border-blue-100 w-64"
                                                placeholder="Search thread keywords..."
                                                value={chatSearch}
                                                onChange={e => setChatSearch(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </header>

                            {/* Dynamic Content Views */}
                            <div className="flex-grow overflow-hidden relative">

                                {/* LIVE MONITOR Marquee (Visible everywhere if active) */}
                                {activeCall && (
                                    <div className="absolute top-0 left-0 right-0 bg-gray-900/95 backdrop-blur-md z-50 py-4 px-10 border-b border-white/10 shadow-xl overflow-hidden animate-in slide-in-from-top duration-500">
                                        <div className="max-w-4xl mx-auto flex items-center gap-6">
                                            <div className="flex-shrink-0 flex items-center gap-3">
                                                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                                                <span className="text-[10px] font-black text-white uppercase tracking-widest whitespace-nowrap">Live Audio Feed</span>
                                            </div>
                                            <div className="flex-grow flex gap-4 overflow-hidden mask-fade-right">
                                                {liveCaptions.length === 0 ? (
                                                    <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest italic animate-pulse">Establishing audio synchronization...</span>
                                                ) : (
                                                    <div className="flex gap-4 animate-marquee-slow whitespace-nowrap">
                                                        {liveCaptions.map((cap, i) => (
                                                            <div key={i} className="flex items-center gap-2">
                                                                <span className="text-blue-400 font-black text-[10px]">{cap.username}:</span>
                                                                <span className="text-white font-medium text-[10px]">{cap.text}</span>
                                                                <span className="px-1.5 py-0.5 bg-white/10 rounded text-[8px] font-black text-white/50">{cap.language}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => setActiveTab("calls")} className="bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-all shadow-lg shadow-blue-600/30">View Analysis</button>
                                        </div>
                                    </div>
                                )}

                                {/* 1. CHAT LOGS VIEW */}
                                {activeTab === "chat" && (
                                    <div className={`h-full flex flex-col ${activeCall ? "pt-20" : ""}`}>
                                        {!selectedFaculty ? (
                                            <div className="flex-grow flex flex-col items-center justify-center p-12 text-center opacity-40">
                                                <i className="bi bi-chat-left-dots text-5xl mb-4"></i>
                                                <p className="font-black uppercase tracking-[0.2em] text-xs">Select Faculty to view conversation archive</p>
                                            </div>
                                        ) : (
                                            <div className="flex-grow overflow-y-auto p-10 bg-gray-50 custom-scrollbar relative h-full">
                                                <div className="space-y-12 max-w-4xl mx-auto pb-20">
                                                    {Object.entries(groupedMessages).map(([date, msgs]) => (
                                                        <div key={date} className="relative">
                                                            <div className="sticky top-0 z-10 flex justify-center mb-10">
                                                                <span className="px-8 py-2.5 bg-white rounded-2xl text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] shadow-lg border border-gray-100 flex items-center gap-3">
                                                                    <i className="bi bi-calendar3 text-blue-400"></i> {date}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-8">
                                                                {msgs.map((msg, idx) => (
                                                                    <div key={idx} className={`flex ${msg.sender === child._id ? "justify-end" : "justify-start"}`}>
                                                                        <div className={`max-w-[85%] flex flex-col ${msg.sender === child._id ? "items-end" : "items-start"}`}>
                                                                            <div className={`px-8 py-5 rounded-[2.5rem] shadow-sm text-sm font-medium leading-relaxed group relative ${msg.sender === child._id
                                                                                ? "bg-blue-600 text-white rounded-tr-none shadow-blue-200"
                                                                                : "bg-white text-gray-800 rounded-tl-none border border-gray-100 shadow-gray-200"
                                                                                }`}>
                                                                                {msg.text}
                                                                                {msg.flagged && (
                                                                                    <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-red-500 border-4 border-white flex items-center justify-center text-white" title={msg.flagReason}>
                                                                                        <i className="bi bi-exclamation-triangle-fill text-[10px]"></i>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className={`text-[9px] font-black uppercase tracking-widest mt-3 opacity-40 flex items-center gap-3 ${msg.sender === child._id ? "flex-row-reverse" : "flex-row"}`}>
                                                                                <span className="text-blue-600 font-black">{msg.sender === child._id ? child.username : selectedFaculty.username}</span>
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                                                                                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 2. SAFETY FLAGS VIEW */}
                                {activeTab === "safety" && (
                                    <div className={`h-full overflow-y-auto p-12 bg-gray-50 custom-scrollbar ${activeCall ? "pt-32" : ""}`}>
                                        <div className="max-w-4xl mx-auto">
                                            <div className="flex items-center justify-between mb-10">
                                                <div>
                                                    <h2 className="text-3xl font-black text-gray-800 flex items-center gap-4">
                                                        <span className="bg-red-100 text-red-600 p-2.5 rounded-2xl"><i className="bi bi-flag-fill"></i></span>
                                                        Safety Flags
                                                    </h2>
                                                </div>
                                                <div className="bg-red-600 text-white px-8 py-4 rounded-3xl shadow-xl shadow-red-600/20 font-black text-xs uppercase tracking-widest">
                                                    Total flags: {flaggedMessages.length}
                                                </div>
                                            </div>
                                            {flaggedMessages.map((msg, i) => (
                                                <div key={i} className="bg-white rounded-[2.5rem] p-8 border border-red-100 shadow-sm mb-6">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <span className="text-[10px] font-black text-red-500 uppercase tracking-widest bg-red-50 px-4 py-2 rounded-xl">{msg.flagReason}</span>
                                                        <span className="text-[10px] text-gray-400 font-bold">{new Date(msg.timestamp).toLocaleString()}</span>
                                                    </div>
                                                    <div className="text-gray-800 font-medium italic">"{msg.text}"</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 3. CALL HISTORY VIEW */}
                                {activeTab === "calls" && (
                                    <div className={`h-full overflow-y-auto p-12 bg-gray-50 custom-scrollbar ${activeCall ? "pt-32" : ""}`}>
                                        <div className="max-w-4xl mx-auto">
                                            <h2 className="text-3xl font-black text-gray-800 mb-10">Interaction Logs</h2>

                                            {/* Live Transcription Feed for Calls Tab */}
                                            {activeCall && (
                                                <div className="bg-white rounded-[3rem] p-8 border border-blue-100 shadow-xl mb-12 animate-in fade-in zoom-in duration-500">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                                                            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest">Real-time Session Transcription</h3>
                                                        </div>
                                                        <span className="bg-blue-600 text-white px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest">Active Link</span>
                                                    </div>
                                                    <div className="bg-gray-50 rounded-2xl p-6 min-h-[200px] border border-gray-100 overflow-y-auto max-h-64 custom-scrollbar">
                                                        {liveCaptions.length === 0 ? (
                                                            <div className="h-full flex flex-col items-center justify-center text-center py-10">
                                                                <i className="bi bi-mic-fill text-gray-200 text-4xl mb-4"></i>
                                                                <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Monitoring silent audio streams...</p>
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-4">
                                                                {liveCaptions.map((cap, i) => (
                                                                    <div key={i} className="flex flex-col gap-1">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{cap.username}</span>
                                                                            <span className="text-[8px] font-black text-gray-400 border border-gray-200 px-2 py-0.5 rounded uppercase">{cap.language}</span>
                                                                        </div>
                                                                        <p className="text-sm text-gray-800 font-medium leading-relaxed">{cap.text}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-4 pb-20">
                                                {callHistory.map((call, i) => (
                                                    <div key={i} className="bg-white p-6 rounded-3xl border border-gray-100 flex items-center justify-between">
                                                        <div className="flex items-center gap-6">
                                                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl ${call.type === "video" ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"}`}>
                                                                <i className={`bi ${call.type === "video" ? "bi-camera-video-fill" : "bi-telephone-fill"}`}></i>
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-black text-gray-800 uppercase tracking-widest">{call.type} Call</div>
                                                                <div className="text-[10px] text-gray-400 font-bold mt-1">Duration: {formatDuration(call.duration || 0)}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-[9px] text-gray-400 font-black uppercase tracking-tighter">{new Date(call.createdAt).toLocaleDateString()}</div>
                                                            <div className="text-[9px] text-gray-400 font-black uppercase tracking-tighter mt-1">{new Date(call.createdAt).toLocaleTimeString()}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 4. SUMMARY VIEW */}
                                {activeTab === "report" && (
                                    <div className="h-full overflow-y-auto p-12 bg-gray-50 custom-scrollbar">
                                        <div className="max-w-4xl mx-auto">
                                            <div className="bg-gray-900 rounded-[3.5rem] p-12 text-white relative overflow-hidden shadow-2xl mb-12">
                                                <div className="relative z-10">
                                                    <div className="inline-block px-6 py-2 bg-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] mb-8">Weekly Safety Summary</div>
                                                    <h2 className="text-6xl font-black mb-6 tracking-tighter leading-[0.9]">Overall Status:<br />
                                                        <span className={flaggedMessages.length > 0 ? "text-red-500" : "text-green-500"}>
                                                            {flaggedMessages.length > 0 ? "Attention Required" : "Secure System"}
                                                        </span>
                                                    </h2>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                                <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm text-center">
                                                    <div className="text-5xl font-black text-gray-800 mb-2">{safetySummary?.totalMessages}</div>
                                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Msgs</div>
                                                </div>
                                                <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm text-center">
                                                    <div className="text-5xl font-black text-gray-800 mb-2">{safetySummary?.totalCalls}</div>
                                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Calls</div>
                                                </div>
                                                <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm text-center">
                                                    <div className="text-5xl font-black text-gray-800 mb-2">{flaggedMessages.length}</div>
                                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Flags</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Global Style for Marquee */}
            <style jsx>{`
                @keyframes marquee-slow {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .animate-marquee-slow {
                    display: inline-flex;
                    animation: marquee-slow 30s linear infinite;
                }
                .animate-marquee-slow:hover {
                    animation-play-state: paused;
                }
                .mask-fade-right {
                    mask-image: linear-gradient(to right, black 85%, transparent 100%);
                }
            `}</style>
        </div>
    );
}

export default Parent;
