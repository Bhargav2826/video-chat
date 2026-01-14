import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import "bootstrap-icons/font/bootstrap-icons.css";

const SOCKET_URL = "/";
const LIVEKIT_URL = "wss://video-chat-wfvq5jjj.livekit.cloud";
const socket = io(SOCKET_URL, { autoConnect: true });

function Faculty() {
    const navigate = useNavigate();
    const username = localStorage.getItem("username") || "Guest";
    const userId = localStorage.getItem("userId");
    const role = localStorage.getItem("role");

    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);
    const [room, setRoom] = useState(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isInCall, setIsInCall] = useState(false);
    const [callStatus, setCallStatus] = useState("idle");
    const [localTracks, setLocalTracks] = useState(null);
    const [focusedVideo, setFocusedVideo] = useState("remote");
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [usersError, setUsersError] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [showSidebar, setShowSidebar] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [captions, setCaptions] = useState([]);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const roomRef = useRef(null);
    const recorderRef = useRef(null);
    const recorderIntervalRef = useRef(null);
    const audioStreamRef = useRef(null);

    useEffect(() => {
        if (role !== "faculty") {
            navigate("/login");
            return;
        }

        const fetchUsers = async () => {
            try {
                setIsLoadingUsers(true);
                const res = await axios.get("/api/auth/all-users");
                setUsers(res.data.filter((u) => u.username !== username));
                setUsersError("");
            } catch (err) {
                setUsersError("Failed to load users");
            } finally {
                setIsLoadingUsers(false);
            }
        };
        fetchUsers();

        socket.emit("register-user", {
            userId: userId || username,
            userName: username,
        });
    }, [username, userId, role, navigate]);

    const tryPlay = async (videoEl, attempts = 5, delayMs = 250) => {
        if (!videoEl) return;
        for (let i = 0; i < attempts; i++) {
            try {
                const p = videoEl.play();
                if (p !== undefined) await p;
                return;
            } catch {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    };

    const startCameraPreview = async () => {
        try {
            let attempts = 0;
            while (!localVideoRef.current && attempts < 20) {
                await new Promise((r) => setTimeout(r, 100));
                attempts++;
            }
            if (!localVideoRef.current) return [];

            const tracks = await createLocalTracks({
                audio: true,
                video: { facingMode: "user" },
            });
            setLocalTracks(tracks);
            const videoTrack = tracks.find((t) => t.kind === "video");
            if (videoTrack) {
                videoTrack.attach(localVideoRef.current);
                await tryPlay(localVideoRef.current);
            }
            setIsPreviewing(true);
            return tracks;
        } catch (err) {
            alert("Please allow camera/microphone access.");
            return [];
        }
    };

    const startAudioCapture = async (usernameForChunks, roomNameForChunks) => {
        try {
            if (recorderRef.current) return;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStreamRef.current = stream;
            const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "audio/webm";
            const recorder = new MediaRecorder(stream, { mimeType });
            recorderRef.current = recorder;
            recorder.ondataavailable = async (e) => {
                if (!e.data || e.data.size === 0) return;
                const arrayBuffer = await e.data.arrayBuffer();
                socket.emit("audio-stream", {
                    audioBuffer: arrayBuffer,
                    username: usernameForChunks,
                    roomName: roomNameForChunks,
                    mimetype: mimeType,
                });
            };
            recorder.start();
            recorderIntervalRef.current = setInterval(() => {
                if (recorder.state === "recording") {
                    recorder.stop();
                    setTimeout(() => { if (recorder.state !== "recording") recorder.start(); }, 200);
                }
            }, 6000);
        } catch (err) { console.error(err); }
    };

    const stopAudioCapture = () => {
        if (recorderIntervalRef.current) clearInterval(recorderIntervalRef.current);
        if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
        if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
        recorderRef.current = null;
        audioStreamRef.current = null;
    };

    const acceptCall = useCallback(async (roomName) => {
        try {
            socket.emit("join-room", roomName);
            setIsInCall(true);
            setIsPreviewing(true);
            setCallStatus("connected");
            await new Promise(r => setTimeout(r, 100));
            const res = await fetch("/api/livekit/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userName: username }),
            });
            const data = await res.json();
            const livekitRoom = new Room({ adaptiveStream: true, dynacast: true });
            livekitRoom.on(RoomEvent.TrackSubscribed, async (track) => {
                if (track.kind === "video") {
                    track.attach(remoteVideoRef.current);
                    await tryPlay(remoteVideoRef.current);
                } else if (track.kind === "audio") {
                    track.attach();
                }
            });
            await livekitRoom.connect(LIVEKIT_URL, data.token);
            let tracks = await createLocalTracks({ audio: true, video: true });
            setLocalTracks(tracks);
            for (const track of tracks) {
                await livekitRoom.localParticipant.publishTrack(track);
            }
            const vTrack = tracks.find(t => t.kind === "video");
            if (vTrack) vTrack.attach(localVideoRef.current);
            setRoom(livekitRoom);
            roomRef.current = livekitRoom;
            startAudioCapture(username, roomName);
        } catch (e) { console.error(e); }
    }, [username]);

    const initiateCall = async () => {
        if (!selectedUser) return;
        const roomName = `room_${[username, selectedUser.username].sort().join("_")}`;
        setCallStatus("calling");
        await startCameraPreview();
        socket.emit("call-user", { toUserId: selectedUser._id, fromUserId: userId, roomName });
        socket.emit("join-room", roomName);
        startAudioCapture(username, roomName);
    };

    useEffect(() => {
        socket.on("incoming-call", ({ fromUserId, fromUserName, roomName }) => {
            setIncomingCall({ id: fromUserId, name: fromUserName, roomName });
            setCallStatus("incoming");
        });
        socket.on("call-response", ({ accepted, roomName }) => {
            if (accepted) acceptCall(roomName);
            else setCallStatus("idle");
        });
        socket.on("new-transcription", (data) => {
            setCaptions(prev => [...prev, data].slice(-5));
        });
        return () => {
            socket.off("incoming-call");
            socket.off("call-response");
            socket.off("new-transcription");
        };
    }, [acceptCall]);

    const toggleMute = () => {
        if (localTracks) {
            localTracks.forEach((track) => {
                if (track.kind === "audio") {
                    track.mediaStreamTrack.enabled = !track.mediaStreamTrack.enabled;
                }
            });
            setIsMuted((prev) => !prev);
        }
    };

    const toggleVideo = () => {
        if (localTracks) {
            localTracks.forEach((track) => {
                if (track.kind === "video") {
                    track.mediaStreamTrack.enabled = !track.mediaStreamTrack.enabled;
                }
            });
            setIsVideoOff((prev) => !prev);
        }
    };

    const endCall = () => {
        stopAudioCapture();
        if (roomRef.current) {
            roomRef.current.disconnect();
            roomRef.current = null;
        }
        setRoom(null);
        setIsInCall(false);
        setIsPreviewing(false);
        setCallStatus("idle");
        setCaptions([]);
        if (localTracks) {
            localTracks.forEach(t => t.stop());
            setLocalTracks(null);
        }
    };

    const handleLogout = () => { localStorage.clear(); navigate("/login"); };

    return (
        <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
            <nav className="flex items-center justify-between px-6 py-4 bg-blue-800 shadow-md z-10 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2 rounded-lg">
                        <i className="bi bi-person-badge-fill text-white text-xl"></i>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-white uppercase italic">Cocoon Faculty Portal</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-blue-900/50 px-4 py-1.5 rounded-full border border-blue-400/30">
                        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                        <span className="text-sm font-semibold">{username} (Faculty)</span>
                    </div>
                    <button onClick={handleLogout} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/50 px-4 py-1.5 rounded-lg text-sm font-medium transition-all">
                        Logout
                    </button>
                </div>
            </nav>

            <div className="flex-grow flex overflow-hidden">
                <aside className="bg-gray-900 border-r border-white/5 w-80 hidden lg:flex flex-col shadow-2xl">
                    <div className="p-6 border-b border-white/5">
                        <h3 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] mb-4">Internal Directory</h3>
                        <div className="relative">
                            <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                            <input
                                className="w-full pl-10 pr-4 py-3 bg-gray-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-600 transition-all font-medium"
                                placeholder="Search staff & students..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-grow overflow-y-auto custom-scrollbar">
                        {isLoadingUsers && (
                            <div className="flex flex-col items-center justify-center p-8 space-y-3">
                                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs text-gray-500 font-medium">Fetching sync...</span>
                            </div>
                        )}
                        {usersError && (
                            <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <p className="text-xs text-red-400 text-center font-medium">{usersError}</p>
                            </div>
                        )}
                        {!isLoadingUsers && users.filter(u => u.username.toLowerCase().includes(searchTerm.toLowerCase())).map(user => (
                            <button
                                key={user._id}
                                onClick={() => setSelectedUser(user)}
                                className={`w-full flex items-center gap-4 px-6 py-4 transition-all border-l-4 ${selectedUser === user ? "bg-blue-600/10 border-blue-500" : "hover:bg-white/5 border-transparent"}`}
                            >
                                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center font-bold text-white shadow-lg">
                                    {user.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-bold text-gray-100">{user.username}</div>
                                    <div className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Active Reachable</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <main className="flex-grow bg-gray-950 relative flex flex-col">
                    {!selectedUser && (
                        <div className="flex-grow flex flex-col items-center justify-center p-12 text-center">
                            <div className="w-32 h-32 bg-blue-500/5 rounded-[2.5rem] border border-blue-500/20 flex items-center justify-center mb-8 rotate-3 hover:rotate-0 transition-transform duration-500 shadow-2xl shadow-blue-500/10">
                                <i className="bi bi-journal-text text-5xl text-blue-500"></i>
                            </div>
                            <h1 className="text-4xl font-black text-white mb-4 tracking-tight">Faculty Management <span className="text-blue-500">Console</span></h1>
                            <p className="text-gray-400 max-w-lg text-lg font-medium leading-relaxed">Select a member from your internal directory to establish a secure encrypted video communication channel.</p>
                        </div>
                    )}

                    {selectedUser && (
                        <div className="flex-grow flex flex-col">
                            <header className="px-8 py-6 bg-gray-900 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-2xl font-black">
                                        {selectedUser.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-white">{selectedUser.username}</h2>
                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                            Video Channel Status: {callStatus}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={initiateCall} disabled={isInCall} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50">
                                    <i className="bi bi-camera-video-fill"></i> Execute Video Call
                                </button>
                            </header>

                            <div className="flex-grow bg-black relative overflow-hidden group/call">
                                {(isPreviewing || isInCall) && (
                                    <div className="h-full w-full flex flex-col md:flex-row p-4 gap-4">
                                        <div className="flex-grow relative bg-gray-900 rounded-3xl overflow-hidden border border-white/5">
                                            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
                                            <div className="absolute bottom-6 left-6 px-4 py-2 bg-black/40 backdrop-blur-md rounded-2xl text-xs font-black tracking-widest uppercase text-white border border-white/10">Remote Transmission</div>
                                        </div>
                                        <div className="w-full md:w-80 h-60 md:h-auto relative bg-gray-900 rounded-3xl overflow-hidden border border-white/5">
                                            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover"></video>
                                            <div className="absolute bottom-6 left-6 px-4 py-2 bg-black/40 backdrop-blur-md rounded-2xl text-xs font-black tracking-widest uppercase text-white border border-white/10">Your Feed</div>
                                        </div>

                                        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 z-30 opacity-0 group-hover/call:opacity-100 transition-all duration-300">
                                            <button
                                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMuted ? "bg-red-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
                                                onClick={toggleMute}
                                                title={isMuted ? "Unmute" : "Mute"}
                                            >
                                                <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} text-xl`}></i>
                                            </button>

                                            <button className="w-18 h-18 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-xl transition-all hover:scale-110 active:scale-90" onClick={endCall}>
                                                <i className="bi bi-telephone-x-fill text-2xl"></i>
                                            </button>

                                            <button
                                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isVideoOff ? "bg-red-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
                                                onClick={toggleVideo}
                                                title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                                            >
                                                <i className={`bi ${isVideoOff ? "bi-camera-video-off-fill" : "bi-camera-video-fill"} text-xl`}></i>
                                            </button>
                                        </div>

                                        {captions.length > 0 && (
                                            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 w-full max-w-xl flex flex-col gap-3 z-20">
                                                {captions.map((c, i) => (
                                                    <div key={i} className="bg-black/60 backdrop-blur-xl p-4 rounded-2xl border border-white/10 text-center animate-in fade-in slide-in-from-bottom-4">
                                                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter block mb-1">{c.username}</span>
                                                        <p className="text-white font-medium italic">"{c.text}"</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {incomingCall && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
                    <div className="bg-gray-900 p-8 rounded-[3rem] border border-blue-500/30 w-full max-w-sm text-center shadow-[0_0_100px_rgba(59,130,246,0.2)]">
                        <div className="w-20 h-20 bg-blue-600 rounded-[2rem] mx-auto mb-6 flex items-center justify-center text-3xl font-black text-white animate-bounce">
                            {incomingCall.name.charAt(0).toUpperCase()}
                        </div>
                        <h3 className="text-2xl font-black text-white mb-2">{incomingCall.name}</h3>
                        <p className="text-gray-500 font-bold uppercase tracking-widest text-xs mb-8">Inbound Request Detected</p>
                        <div className="flex gap-4">
                            <button onClick={() => acceptCall(incomingCall.roomName)} className="flex-grow py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg transition-all active:scale-95">Accept</button>
                            <button onClick={() => setIncomingCall(null)} className="flex-grow py-4 bg-red-600 text-white font-black rounded-2xl shadow-lg transition-all active:scale-95">Decline</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Faculty;
