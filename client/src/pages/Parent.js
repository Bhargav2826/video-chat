import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import "bootstrap-icons/font/bootstrap-icons.css";

const SOCKET_URL = "/";
const LIVEKIT_URL = "wss://video-chat-wfvq5jjj.livekit.cloud";
const socket = io(SOCKET_URL, { autoConnect: true });

function Parent() {
    const navigate = useNavigate();
    const username = localStorage.getItem("username") || "Guest";
    const userId = localStorage.getItem("userId");
    const role = localStorage.getItem("role");

    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [incomingCall, setIncomingCall] = useState(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isInCall, setIsInCall] = useState(false);
    const [callStatus, setCallStatus] = useState("idle");
    const [localTracks, setLocalTracks] = useState(null);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [usersError, setUsersError] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [captions, setCaptions] = useState([]);
    const [isMinimized, setIsMinimized] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const roomRef = useRef(null);
    const recorderRef = useRef(null);
    const recorderIntervalRef = useRef(null);
    const audioStreamRef = useRef(null);

    useEffect(() => {
        if (role !== "parent") {
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
            setIsPreviewing(true); // Must be true so the video container renders and Ref becomes available
            let attempts = 0;
            while (!localVideoRef.current && attempts < 20) {
                await new Promise((r) => setTimeout(r, 100));
                attempts++;
            }
            if (!localVideoRef.current) {
                console.error("❌ localVideoRef still null after 20 attempts");
                return [];
            }

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
            await new Promise(r => setTimeout(r, 200));
            const res = await fetch("/api/livekit/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomName, userName: username }),
            });
            const data = await res.json();
            const livekitRoom = new Room({ adaptiveStream: true, dynacast: true });
            livekitRoom.on(RoomEvent.TrackSubscribed, async (track) => {
                if (track.kind === "video") {
                    if (remoteVideoRef.current) {
                        track.attach(remoteVideoRef.current);
                        await tryPlay(remoteVideoRef.current);
                    }
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
            if (vTrack && localVideoRef.current) {
                vTrack.attach(localVideoRef.current);
                await tryPlay(localVideoRef.current);
            }

            // Sync existing remote tracks
            livekitRoom.remoteParticipants.forEach((participant) => {
                participant.trackPublications.forEach((pub) => {
                    if (pub.isSubscribed && pub.track) {
                        if (pub.track.kind === "video" && remoteVideoRef.current) {
                            pub.track.attach(remoteVideoRef.current);
                            tryPlay(remoteVideoRef.current);
                        } else if (pub.track.kind === "audio") {
                            pub.track.attach();
                        }
                    }
                });
            });

            roomRef.current = livekitRoom;
            startAudioCapture(username, roomName);
        } catch (e) { console.error(e); }
    }, [username]);

    const handleAcceptCall = () => {
        if (!incomingCall) return;
        socket.emit("call-response", {
            toUserId: incomingCall.id,
            accepted: true,
            roomName: incomingCall.roomName,
        });
        setIncomingCall(null);
        acceptCall(incomingCall.roomName);
    };

    const handleDeclineCall = () => {
        if (!incomingCall) return;
        socket.emit("call-response", { toUserId: incomingCall.id, accepted: false });
        setIncomingCall(null);
        setCallStatus("idle");
    };

    const initiateCall = async () => {
        if (!selectedUser) return;
        setIsPreviewing(true);
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
        setIsInCall(false);
        setIsPreviewing(false);
        setCallStatus("idle");
        setIsMinimized(false);
        setCaptions([]);
        if (localTracks) {
            localTracks.forEach(t => t.stop());
            setLocalTracks(null);
        }
    };

    const handleLogout = () => { localStorage.clear(); navigate("/login"); };

    return (
        <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
            <nav className="flex items-center justify-between px-6 py-4 bg-white shadow-md z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg">
                        <i className="bi bi-heart-fill text-white text-xl"></i>
                    </div>
                    <span className="text-xl font-black tracking-tighter text-blue-900">COCOON <span className="text-gray-400">PARENT DASHBOARD</span></span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-2xl border border-gray-200">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                        <span className="text-sm font-bold text-gray-800">{username}</span>
                    </div>
                    <button onClick={handleLogout} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                        Logout
                    </button>
                </div>
            </nav>

            <div className="flex-grow flex overflow-hidden">
                <aside className="bg-white border-r border-gray-100 w-80 hidden lg:flex flex-col shadow-sm">
                    <div className="p-6 border-b border-gray-100">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 text-center">Contact Center</h3>
                        <div className="relative">
                            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input
                                className="w-full pl-11 pr-4 py-4 bg-gray-50 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 placeholder-gray-400 transition-all font-semibold"
                                placeholder="Find faculty or student..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-grow overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {isLoadingUsers && (
                            <div className="flex flex-col items-center justify-center p-8 space-y-3">
                                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-widest">Bridging connections...</span>
                            </div>
                        )}
                        {usersError && (
                            <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <p className="text-xs text-red-500 text-center font-bold tracking-tight">{usersError}</p>
                            </div>
                        )}
                        {!isLoadingUsers && users.filter(u => u.username.toLowerCase().includes(searchTerm.toLowerCase())).map(user => (
                            <button
                                key={user._id}
                                onClick={() => setSelectedUser(user)}
                                className={`w-full flex items-center gap-4 px-4 py-4 transition-all rounded-2xl ${selectedUser === user ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "hover:bg-gray-50 text-gray-600"}`}
                            >
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${selectedUser === user ? "bg-white/20 text-white" : "bg-blue-100 text-blue-600"}`}>
                                    {user.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="text-left min-w-0">
                                    <div className={`text-sm font-black truncate ${selectedUser === user ? "text-white" : "text-gray-800"}`}>{user.username}</div>
                                    <div className={`text-[10px] font-bold uppercase tracking-tight ${selectedUser === user ? "text-blue-100" : "text-gray-400"}`}>Available for call</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <main className="flex-grow flex flex-col relative bg-gray-50">
                    {!selectedUser && (
                        <div className="flex-grow flex flex-col items-center justify-center p-12 text-center text-gray-800">
                            <div className="w-40 h-40 bg-white rounded-[3rem] shadow-2xl flex items-center justify-center mb-10 border border-gray-100 animate-pulse">
                                <i className="bi bi-pc-display-horizontal text-7xl text-blue-600"></i>
                            </div>
                            <h1 className="text-5xl font-black mb-4 tracking-tighter">Welcome to <span className="text-blue-600">Parent Dashboard</span></h1>
                            <p className="text-gray-500 max-w-lg text-xl font-medium leading-relaxed">Connect instantly with faculty members and stay updated with your child's progress through secure video sessions.</p>
                        </div>
                    )}

                    {selectedUser && (
                        <div className="flex-grow flex flex-col">
                            <header className="px-10 py-8 bg-white border-b border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-tr from-blue-600 to-blue-400 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-blue-600/30">
                                        {selectedUser.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black text-gray-800">{selectedUser.username}</h2>
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                                            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping"></span>
                                            Encrypted Connection: {callStatus}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={initiateCall} disabled={isInCall} className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black flex items-center gap-3 transition-all shadow-2xl shadow-blue-600/40 transform active:scale-95 disabled:opacity-50">
                                    <i className="bi bi-camera-video-fill text-xl"></i> START SECURE CALL
                                </button>
                            </header>

                            <div className="flex-grow bg-gray-100 flex flex-col items-center justify-center p-6">
                                <div className="bg-white p-12 rounded-[3.5rem] border border-gray-100 shadow-2xl text-center max-w-lg">
                                    <div className="w-24 h-24 bg-blue-50/50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-blue-100">
                                        <i className="bi bi-camera-video-fill text-4xl text-blue-600"></i>
                                    </div>
                                    <h3 className="text-2xl font-black text-gray-800 mb-4 tracking-tight">Ready for a secure session?</h3>
                                    <p className="text-gray-500 font-medium mb-10 leading-relaxed text-lg">Click below to initialize an encrypted video connection with {selectedUser.username}.</p>
                                    <button onClick={initiateCall} className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[1.5rem] font-black flex items-center justify-center gap-3 transition-all shadow-2xl shadow-blue-600/40 transform active:scale-95">
                                        <i className="bi bi-shield-check text-xl"></i> START SECURE CALL
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* IMMERSIVE VIDEO CALL OVERLAY */}
            {(isPreviewing || isInCall || callStatus === "calling" || callStatus === "connected") && (
                <div className={`fixed z-[150] transition-all duration-500 ease-in-out group/call ${isMinimized
                    ? "bottom-8 right-8 w-96 h-60 rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.6)] border border-white/10 overflow-hidden hover:scale-[1.02] hover:shadow-blue-600/20"
                    : "inset-0 bg-gray-950 flex flex-col overflow-hidden"}`}>

                    {/* Window Controls - Top Right */}
                    <div className={`absolute top-5 right-5 flex items-center gap-2 z-[170] transition-opacity duration-300 ${isMinimized ? "opacity-0 group-hover/call:opacity-100" : "opacity-100"}`}>
                        <button
                            onClick={() => setIsMinimized(!isMinimized)}
                            className="w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-xl flex items-center justify-center border border-white/10 transition-all active:scale-90"
                            title={isMinimized ? "Restore to Full Screen" : "Minimize to Corner"}
                        >
                            <i className={`bi ${isMinimized ? "bi-arrows-angle-expand" : "bi-arrows-angle-contract"} text-sm text-white`}></i>
                        </button>
                        <button
                            onClick={endCall}
                            className="w-10 h-10 rounded-2xl bg-red-500/80 hover:bg-red-500 backdrop-blur-xl flex items-center justify-center border border-white/10 transition-all active:scale-90"
                            title="End Call / Disconnect"
                        >
                            <i className="bi bi-x-lg text-sm text-white"></i>
                        </button>
                    </div>

                    {/* Minimized Quick Info - Bottom Left */}
                    {isMinimized && (
                        <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between z-[170] pointer-events-none transition-opacity duration-300 group-hover/call:opacity-0">
                            <div className="flex items-center gap-3 bg-black/40 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/5">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                <span className="text-[10px] font-black text-white/90 uppercase tracking-widest">{selectedUser?.username}</span>
                            </div>
                        </div>
                    )}

                    {/* Minimized Hover Controls */}
                    {isMinimized && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm opacity-0 group-hover/call:opacity-100 transition-all duration-300 flex items-center justify-center gap-4 z-[165]">
                            <button onClick={toggleMute} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isMuted ? "bg-red-500 text-white" : "bg-white/10 text-white border border-white/20 hover:bg-white/20"}`}>
                                <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} text-xl`}></i>
                            </button>
                            <button onClick={endCall} className="w-14 h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-xl active:scale-90">
                                <i className="bi bi-telephone-x-fill text-2xl"></i>
                            </button>
                        </div>
                    )}

                    {!isMinimized && (
                        <div className="absolute top-0 left-0 w-full p-10 flex items-center justify-between z-[160] pointer-events-none">
                            <div className="flex items-center gap-5 bg-black/20 backdrop-blur-2xl px-8 py-4 rounded-3xl border border-white/5 pointer-events-auto">
                                <div className="w-4 h-4 rounded-full bg-green-500 animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.5)]"></div>
                                <span className="text-sm font-black text-white uppercase tracking-[0.4em]">SECURE CHANNEL: {selectedUser?.username}</span>
                            </div>
                            <div className="bg-blue-600/20 backdrop-blur-2xl px-6 py-4 rounded-3xl border border-blue-500/20 pointer-events-auto">
                                <span className="text-xs font-black text-blue-400 uppercase tracking-widest">{callStatus}</span>
                            </div>
                        </div>
                    )}

                    <div className={`flex-grow relative flex flex-col ${isMinimized ? "p-0" : "md:flex-row gap-8 p-10 pt-36 h-full"}`}>
                        {/* Remote Video Container */}
                        <div className={`flex-grow relative bg-gray-900 overflow-hidden border border-white/5 transition-all duration-700 ${isMinimized ? "rounded-none h-full" : "rounded-[4rem] shadow-[0_0_120px_rgba(0,0,0,0.8)]"}`}>
                            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
                            {!isMinimized && (
                                <>
                                    <div className="absolute bottom-12 left-12 px-8 py-4 bg-black/40 backdrop-blur-2xl rounded-3xl border border-white/10 flex items-center gap-4">
                                        <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                                        <span className="text-xs font-black text-white uppercase tracking-[0.2em]">{selectedUser?.username}</span>
                                    </div>
                                    <div className="absolute top-12 right-12 flex items-center gap-3 bg-blue-600/30 backdrop-blur-xl px-5 py-3 rounded-2xl border border-blue-500/30 text-blue-300 text-[10px] font-black uppercase tracking-[0.3em]">
                                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                                        Real-time Feed
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Local Video Container */}
                        <div className={`${isMinimized
                            ? "absolute bottom-4 right-4 w-32 h-20 outline outline-4 outline-black/40"
                            : "w-full md:w-[480px] border border-white/10 shadow-3xl"} relative bg-gray-900 rounded-[2.5rem] overflow-hidden transition-all duration-700 aspect-video md:aspect-auto`}>
                            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover"></video>
                            {!isMinimized && (
                                <div className="absolute bottom-10 left-10 px-6 py-3 bg-black/40 backdrop-blur-2xl rounded-2xl border border-white/10 flex items-center gap-3">
                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">MY STREAM (PREVIEW)</span>
                                </div>
                            )}
                        </div>

                        {!isMinimized && (
                            <>
                                {/* Control Bar */}
                                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-5 bg-black/40 backdrop-blur-[40px] rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.4)] z-50">
                                    <button
                                        className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${isMuted ? "bg-red-500 text-white shadow-[0_10px_20px_rgba(239,68,68,0.3)]" : "bg-white/10 hover:bg-white/20 text-white border border-white/10"}`}
                                        onClick={toggleMute}
                                        title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                                    >
                                        <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} text-xl`}></i>
                                    </button>

                                    <button className="w-16 h-16 rounded-2xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-[0_15px_30px_rgba(220,38,38,0.4)] transition-all active:scale-90" onClick={endCall} title="End Call">
                                        <i className="bi bi-telephone-x-fill text-2xl"></i>
                                    </button>

                                    <button
                                        className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${isVideoOff ? "bg-red-500 text-white shadow-[0_10px_20px_rgba(239,68,68,0.3)]" : "bg-white/10 hover:bg-white/20 text-white border border-white/10"}`}
                                        onClick={toggleVideo}
                                        title={isVideoOff ? "Enable Camera" : "Disable Camera"}
                                    >
                                        <i className={`bi ${isVideoOff ? "bi-camera-video-off-fill" : "bi-camera-video-fill"} text-xl`}></i>
                                    </button>
                                </div>

                                {/* Overlay Captions */}
                                {captions.length > 0 && (
                                    <div className="absolute bottom-52 left-1/2 -translate-x-1/2 w-full max-w-4xl flex flex-col gap-5 z-20 pointer-events-none px-10">
                                        {captions.map((c, i) => (
                                            <div key={i} className="bg-black/60 backdrop-blur-[50px] px-12 py-8 rounded-[3.5rem] border border-white/10 text-center shadow-3xl animate-in slide-in-from-bottom-12 duration-700">
                                                <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] block mb-3 border-b border-white/5 pb-3">{c.username}</span>
                                                <p className="text-white text-2xl font-black leading-tight tracking-tight">"{c.text}"</p>
                                                <div className="flex items-center justify-center gap-3 mt-4">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                                                    <span className="text-[10px] text-white/40 font-black uppercase tracking-[0.3em]">{c.language} Optimized</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {incomingCall && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-blue-900/40 backdrop-blur-xl p-6">
                    <div className="bg-white p-10 rounded-[3.5rem] border border-white w-full max-w-md text-center shadow-[0_40px_100px_rgba(30,58,138,0.3)] transform scale-110">
                        <div className="w-28 h-28 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-[2.5rem] mx-auto mb-8 flex items-center justify-center text-4xl font-black text-white shadow-2xl shadow-blue-600/40 animate-pulse">
                            {incomingCall.name.charAt(0).toUpperCase()}
                        </div>
                        <h3 className="text-3xl font-black text-gray-800 mb-2">{incomingCall.name}</h3>
                        <p className="text-gray-400 font-black uppercase tracking-[0.3em] text-[10px] mb-10">Signaling Verification Incoming</p>
                        <div className="flex gap-6">
                            <button onClick={handleAcceptCall} className="flex-grow py-5 bg-blue-600 text-white font-black rounded-3xl shadow-2xl shadow-blue-600/40 transition-all hover:bg-blue-500 active:scale-95">ACCEPT CALL</button>
                            <button onClick={handleDeclineCall} className="flex-grow py-5 bg-gray-100 text-gray-500 font-black rounded-3xl transition-all hover:bg-gray-200 active:scale-95">DECLINE</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Parent;
