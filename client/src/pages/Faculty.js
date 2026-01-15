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
            setIsPreviewing(true);
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
                        <i className="bi bi-mortarboard-fill text-white text-xl"></i>
                    </div>
                    <span className="text-xl font-black tracking-tighter text-blue-900">COCOON <span className="text-gray-400">FACULTY DASHBOARD</span></span>
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
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 text-center">Faculty Directory</h3>
                        <div className="relative">
                            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input
                                className="w-full pl-11 pr-4 py-4 bg-gray-50 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 placeholder-gray-400 transition-all font-semibold"
                                placeholder="Find student or parent..."
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
                                <i className="bi bi-briefcase-fill text-7xl text-blue-600"></i>
                            </div>
                            <h1 className="text-5xl font-black mb-4 tracking-tighter">Welcome to <span className="text-blue-600">Faculty Dashboard</span></h1>
                            <p className="text-gray-500 max-w-lg text-xl font-medium leading-relaxed">Connect instantly with students and parents to provide academic support and feedback through secure video sessions.</p>
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

                            <div className="flex-grow bg-gray-100 relative overflow-hidden p-6 group/call">
                                {(isPreviewing || isInCall || callStatus === "calling" || callStatus === "connected") && (
                                    <div className="h-full w-full flex flex-col md:flex-row gap-6">
                                        <div className="flex-grow relative bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-gray-100">
                                            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
                                            <div className="absolute top-6 left-6 px-4 py-2 bg-blue-600 rounded-xl text-[10px] font-black tracking-widest uppercase text-white shadow-lg shadow-blue-600/30 font-bold">LIVE FEED</div>
                                        </div>
                                        <div className="w-full md:w-96 relative bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-gray-100">
                                            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover"></video>
                                            <div className="absolute top-6 left-6 px-4 py-2 bg-gray-900 rounded-xl text-[10px] font-black tracking-widest uppercase text-white font-bold">YOU</div>
                                        </div>

                                        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 z-30 opacity-0 group-hover/call:opacity-100 transition-all scale-90 group-hover/call:scale-100">
                                            <button
                                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl ${isMuted ? "bg-red-500 text-white" : "bg-white text-gray-400 hover:text-blue-500"}`}
                                                onClick={toggleMute}
                                                title={isMuted ? "Unmute" : "Mute"}
                                            >
                                                <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} text-2xl`}></i>
                                            </button>

                                            <button className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-2xl transition-all hover:rotate-90 active:scale-90" onClick={endCall}>
                                                <i className="bi bi-telephone-x-fill text-3xl"></i>
                                            </button>

                                            <button
                                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl ${isVideoOff ? "bg-red-500 text-white" : "bg-white text-gray-400 hover:text-blue-500"}`}
                                                onClick={toggleVideo}
                                                title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                                            >
                                                <i className={`bi ${isVideoOff ? "bi-camera-video-off-fill" : "bi-camera-video-fill"} text-2xl`}></i>
                                            </button>
                                        </div>

                                        {captions.length > 0 && (
                                            <div className="absolute bottom-36 left-1/2 -translate-x-1/2 w-full max-w-2xl flex flex-col gap-4 z-20 pointer-events-none">
                                                {captions.map((c, i) => (
                                                    <div key={i} className="bg-white shadow-2xl p-6 rounded-[2rem] border border-gray-100 text-center animate-in fade-in slide-in-from-bottom-6 duration-700">
                                                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter block mb-2">{c.username}</span>
                                                        <p className="text-gray-800 text-lg font-bold leading-tight">"{c.text}"</p>
                                                        <span className="text-[10px] text-gray-400 font-bold mt-2 block">{c.language} detected</span>
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

export default Faculty;
