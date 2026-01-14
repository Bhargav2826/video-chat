import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
// We will use standard SVG icons or an icon library if available, 
// for now keeping bootstrap-icons as they can be used with Tailwind too, 
// or I can replace them with Heroicons-like styles if needed.
// But user only asked to convert framework, so keeping the icon font is fine for now.
import "bootstrap-icons/font/bootstrap-icons.css";

const SOCKET_URL = "/";
const LIVEKIT_URL = "wss://video-chat-wfvq5jjj.livekit.cloud";
const socket = io(SOCKET_URL, { autoConnect: true });

function Home() {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "Guest";
  const userId = localStorage.getItem("userId");

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

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);

  // Refs for audio capture
  const recorderRef = useRef(null);
  const recorderIntervalRef = useRef(null);
  const audioStreamRef = useRef(null);

  // -------------------- Fetch Users --------------------
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setIsLoadingUsers(true);
        const res = await axios.get("/api/auth/all-users");
        setUsers(res.data.filter((u) => u.username !== username));
        setUsersError("");
      } catch (err) {
        console.error(err);
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
  }, [username, userId]);

  // -------------------- Reliable play helper --------------------
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

  // -------------------- Start Camera Preview --------------------
  const startCameraPreview = async () => {
    try {
      console.log("🎥 Starting local camera preview...");
      let attempts = 0;
      while (!localVideoRef.current && attempts < 20) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      if (!localVideoRef.current) {
        console.warn("⚠️ localVideoRef not ready after waiting — forcing re-render check");
        setIsPreviewing((prev) => !prev);
        await new Promise((r) => setTimeout(r, 300));
      }

      if (!localVideoRef.current) {
        console.error("❌ Still no local video element available — aborting preview.");
        return [];
      }

      if (localTracks && localTracks.length > 0) {
        const prevVideoTrack = localTracks.find((t) => t.kind === "video");
        if (prevVideoTrack) {
          prevVideoTrack.attach(localVideoRef.current);
          await tryPlay(localVideoRef.current);
          console.log("✅ Reused existing local preview tracks");
          setIsPreviewing(true);
          return localTracks;
        }
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
        console.log("✅ Local preview started successfully");
      }

      setIsPreviewing(true);
      return tracks;
    } catch (err) {
      console.error("⚠️ Could not start camera preview:", err);
      alert("Please allow camera/microphone access.");
      return [];
    }
  };

  // -------------------- Audio capture utilities --------------------
  const startAudioCapture = async (usernameForChunks, roomNameForChunks) => {
    try {
      // if already running, don't start again
      if (recorderRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Prefer OGG/Opus if supported; fallback to WebM/Opus
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm");

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        try {
          if (!e.data || e.data.size === 0) return;
          // send binary ArrayBuffer directly (avoids base64 corruption)
          const arrayBuffer = await e.data.arrayBuffer();

          console.log("🎙️ Sending audio chunk from", usernameForChunks, "size:", arrayBuffer.byteLength, "mime:", mimeType);

          socket.emit("audio-stream", {
            audioBuffer: arrayBuffer,
            username: usernameForChunks,
            roomName: roomNameForChunks,
            mimetype: mimeType,
          });
        } catch (err) {
          console.error("Error ondataavailable:", err);
        }
      };

      recorder.onerror = (ev) => {
        console.error("Recorder error:", ev);
      };

      recorder.start();

      // stop & restart regularly to force chunking (~12s to improve ASR quality)
      recorderIntervalRef.current = setInterval(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          // let ondataavailable run, then restart in 200ms
          setTimeout(() => {
            try {
              if (recorder.state !== "recording") recorder.start();
            } catch (_) { }
          }, 200);
        }
      }, 12000);
    } catch (err) {
      console.error("🎙️ Error starting audio capture:", err);
    }
  };

  const stopAudioCapture = () => {
    try {
      if (recorderIntervalRef.current) {
        clearInterval(recorderIntervalRef.current);
        recorderIntervalRef.current = null;
      }
      if (recorderRef.current) {
        try {
          if (recorderRef.current.state === "recording") recorderRef.current.stop();
        } catch (_) { }
        recorderRef.current = null;
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
    } catch (err) {
      console.error("Error stopping audio capture:", err);
    }
  };

  // -------------------- Accept / Join Call --------------------
  const acceptCall = useCallback(async (roomName, callerName) => {
    try {
      console.log(`📞 Joining room: ${roomName} as ${username}`);

      // Set these immediately so the video elements render
      setIsInCall(true);
      setIsPreviewing(true);
      setCallStatus("connected");

      // Give React a moment to render the video elements so refs are not NULL
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get LiveKit token
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, userName: username }),
      });
      const data = await res.json();
      if (!data.token) throw new Error("No token received!");

      // Create LiveKit room
      const livekitRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Setup event handlers BEFORE connecting
      livekitRoom.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        console.log(`📹 NEW TRACK from ${participant.identity}: ${track.kind}`);

        if (track.kind === "video") {
          if (!remoteVideoRef.current) {
            console.error("❌ remoteVideoRef.current is NULL!");
            return;
          }

          // Attach the remote video track
          track.attach(remoteVideoRef.current);
          await tryPlay(remoteVideoRef.current);
          console.log("✅ REMOTE VIDEO ATTACHED");
        } else if (track.kind === "audio") {
          // Attach the remote audio track (LiveKit handles creating an audio element if none provided)
          track.attach();
          console.log("✅ REMOTE AUDIO ATTACHED");
        }
      });

      livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === "video") {
          track.detach();
          console.log("📹 Remote video detached");
        }
      });

      // Connect to room
      await livekitRoom.connect(LIVEKIT_URL, data.token);
      console.log("✅ CONNECTED TO ROOM");

      // Create or reuse local tracks
      let tracks = localTracks;
      if (!tracks || tracks.length === 0) {
        console.log("🎥 Creating camera/mic tracks...");
        tracks = await createLocalTracks({
          audio: true,
          video: { facingMode: "user", width: 1280, height: 720 },
        });
        setLocalTracks(tracks);
      }

      // Publish tracks to room
      console.log("📤 Publishing tracks...");
      for (const track of tracks) {
        await livekitRoom.localParticipant.publishTrack(track, {
          videoCodec: 'vp8',
        });
        console.log(`✅ Published ${track.kind}`);
      }

      // Attach local video
      const videoTrack = tracks.find(t => t.kind === "video");
      if (videoTrack) {
        if (!localVideoRef.current) {
          console.error("❌ localVideoRef.current is NULL!");
        } else {
          videoTrack.attach(localVideoRef.current);
          localVideoRef.current.muted = true; // Prevent echo
          await tryPlay(localVideoRef.current);
          console.log("✅ LOCAL VIDEO ATTACHED");
        }
      } else {
        console.error("❌ No video track found in tracks!");
      }

      // Wait a bit for remote participants to publish
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check for existing remote tracks (handle race condition)
      console.log(`👥 ${livekitRoom.remoteParticipants.size} remote participants`);
      livekitRoom.remoteParticipants.forEach((participant) => {
        console.log(`Checking ${participant.identity}...`);
        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) {
            if (pub.track.kind === "video" && remoteVideoRef.current) {
              console.log(`📹 Found existing video from ${participant.identity}`);
              pub.track.attach(remoteVideoRef.current);
              tryPlay(remoteVideoRef.current);
              console.log("✅ EXISTING REMOTE VIDEO ATTACHED");
            } else if (pub.track.kind === "audio") {
              console.log(`🔉 Found existing audio from ${participant.identity}`);
              pub.track.attach();
              console.log("✅ EXISTING REMOTE AUDIO ATTACHED");
            }
          }
        });
      });

      // Update state
      setRoom(livekitRoom);
      roomRef.current = livekitRoom;

      // Start audio transcription
      startAudioCapture(username, roomName);

      console.log("🎉 CALL SETUP COMPLETE");
    } catch (error) {
      console.error("❌ Call failed:", error);
      alert(`Failed to join call: ${error.message}`);
      setIsInCall(false);
      setIsPreviewing(false);
      setCallStatus("idle");
    }
  }, [localTracks, username]);

  // -------------------- Initiate Call --------------------
  const initiateCall = async () => {
    if (!selectedUser) return alert("Select a user first.");
    const toUserId = selectedUser._id;
    const fromUserId = userId || username;
    const roomName = `room_${[username, selectedUser.username].sort().join("_")}`;


    setCallStatus("calling");

    console.log("🎥 Preparing camera before call...");
    const tracks = await startCameraPreview();

    if (!tracks || tracks.length === 0) {
      console.warn("⚠️ Camera preview could not start. Proceeding with audio-only capture.");
    }

    console.log("📞 Camera ready, now sending call event...");
    socket.emit("call-user", { toUserId, fromUserId, roomName });
    // Start capturing audio immediately for the caller, even before callee joins
    startAudioCapture(username, roomName);
    alert(`Calling ${selectedUser.username}... waiting for acceptance.`);
  };

  // -------------------- Socket Events --------------------
  useEffect(() => {
    socket.on("incoming-call", ({ fromUserId, fromUserName, roomName }) => {
      setIncomingCall({ id: fromUserId, name: fromUserName, roomName });
      setCallStatus("incoming");
    });

    socket.on("call-response", ({ accepted, roomName }) => {
      if (accepted) {
        setCallStatus("connected");
        acceptCall(roomName, username);
      } else {
        alert("Call declined by user.");
        // Stop capture if we started it during initiateCall
        stopAudioCapture();
        setCallStatus("idle");
      }
    });

    return () => {
      socket.off("incoming-call");
      socket.off("call-response");
    };
  }, [username, localTracks, acceptCall]);

  // -------------------- End Call --------------------
  const endCall = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setRoom(null); // CRITICAL: Reset room state to show "Start Video Call" button again

    if (localVideoRef.current?.srcObject)
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
    if (remoteVideoRef.current?.srcObject)
      remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());

    setLocalTracks(null);
    setIsPreviewing(false);
    setIsInCall(false);
    setIncomingCall(null);
    setCallStatus("idle");
    setFocusedVideo("remote");

    // stop audio capture when call ends
    stopAudioCapture();
    console.log("📞 Call ended and state reset.");
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;

    // Find the caller in our users list to get the full user object if possible
    const caller = users.find(u => u._id === incomingCall.id) || {
      _id: incomingCall.id,
      username: incomingCall.name
    };

    setSelectedUser(caller);

    socket.emit("call-response", {
      toUserId: incomingCall.id,
      accepted: true,
      roomName: incomingCall.roomName,
    });
    setIncomingCall(null);
    setCallStatus("connected");
    acceptCall(incomingCall.roomName, username);
  };

  const handleDeclineCall = () => {
    if (!incomingCall) return;
    socket.emit("call-response", { toUserId: incomingCall.id, accepted: false });
    setIncomingCall(null);
    setCallStatus("idle");
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/login");
  };

  // -------------------- Toggle Buttons --------------------
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

  const onLocalClick = () => setFocusedVideo((prev) => (prev === "local" ? "remote" : "local"));
  const onRemoteClick = () => setFocusedVideo((prev) => (prev === "remote" ? "local" : "remote"));

  // -------------------- JSX --------------------
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-6 py-4 bg-emerald-700 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-lg">
            <i className="bi bi-chat-dots-fill text-white text-xl"></i>
          </div>
          <span className="text-xl font-bold tracking-tight">VideoConnect</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="lg:hidden bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-all"
            onClick={() => setShowSidebar(true)}
          >
            <i className="bi bi-people-fill"></i>
            <span>Users</span>
          </button>
          <div className="hidden sm:flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
            <span className="text-sm font-medium">{username}</span>
          </div>
          <button
            className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/50 px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
            onClick={handleLogout}
          >
            <i className="bi bi-box-arrow-right"></i>
            <span>Logout</span>
          </button>
        </div>
      </nav>

      <div className="flex-grow flex overflow-hidden">
        {/* Sidebar */}
        <aside className="bg-gray-900 border-r border-white/5 w-80 hidden lg:flex flex-col shadow-2xl">
          <div className="p-4 border-b border-white/5 space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Messages</h3>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">
                <i className="bi bi-search"></i>
              </span>
              <input
                className="block w-full pl-10 pr-3 py-2 bg-gray-800 border border-transparent rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:bg-gray-700 transition-all font-medium"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-grow overflow-y-auto overflow-x-hidden custom-scrollbar">
            {isLoadingUsers && (
              <div className="flex flex-col items-center justify-center p-8 space-y-3">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs text-gray-500 font-medium">Fetching users...</span>
              </div>
            )}
            {!isLoadingUsers && usersError && (
              <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-xs text-red-400 text-center font-medium">{usersError}</p>
              </div>
            )}
            {!isLoadingUsers && !usersError && (
              <div className="py-2">
                {users
                  .filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((user) => (
                    <button
                      key={user._id}
                      className={`w-full flex items-center gap-3 px-4 py-3 transition-all duration-200 group text-left ${selectedUser === user ? "bg-emerald-600/10 border-r-4 border-emerald-500" : "hover:bg-white/5"}`}
                      onClick={() => setSelectedUser(selectedUser === user ? null : user)}
                    >
                      <div className="relative flex-shrink-0">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white ring-2 ring-gray-950 group-hover:scale-105 transition-transform">
                          <span className="font-bold text-lg">{String(user.username || "?").charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900 shadow-sm"></div>
                      </div>
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-semibold text-gray-100 truncate">{user.username}</span>
                          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">ONLINE</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate group-hover:text-gray-400 transition-colors">Start a video conversation</p>
                      </div>
                    </button>
                  ))}
                {users.filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm text-gray-500 font-medium italic">No users available</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-grow flex flex-col relative bg-gray-950">
          {!selectedUser && (
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-emerald-500/20">
                <i className="bi bi-camera-video text-4xl text-emerald-500"></i>
              </div>
              <h1 className="text-4xl font-extrabold text-white mb-3">Welcome, <span className="text-emerald-500">{username}</span> 👋</h1>
              <p className="text-gray-400 max-w-md text-lg leading-relaxed">Select a teammate from the sidebar to start a high-quality video call instantly.</p>
            </div>
          )}

          {selectedUser && (
            <div className="flex-grow flex flex-col h-full">
              {/* Call Header */}
              <header className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-white/5 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                      <span className="font-bold text-xl">{String(selectedUser.username || "?").charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-4 border-gray-900"></div>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white leading-tight">{selectedUser.username}</h2>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${callStatus === "connected" ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}></span>
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{callStatus === "connected" ? "Securely Connected" : callStatus}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="p-3 rounded-xl bg-gray-800 hover:bg-emerald-600 text-white transition-all disabled:opacity-30 disabled:hover:bg-gray-800"
                    onClick={initiateCall}
                    disabled={!!room || isInCall || isPreviewing}
                    title="Start Video Call"
                  >
                    <i className="bi bi-camera-video-fill text-xl"></i>
                  </button>
                  <button
                    className="p-3 rounded-xl bg-gray-800 hover:bg-red-600 text-white transition-all disabled:opacity-30 disabled:hover:bg-gray-800"
                    onClick={endCall}
                    disabled={!isInCall && !isPreviewing}
                    title="End Call"
                  >
                    <i className="bi bi-telephone-x-fill text-xl"></i>
                  </button>
                </div>
              </header>

              {/* Start Call CTA */}
              {!room && !incomingCall && !isInCall && !isPreviewing && (
                <div className="flex-grow flex items-center justify-center p-6 bg-gray-950/50 backdrop-blur-sm">
                  <div className="text-center p-8 bg-gray-900 rounded-3xl border border-white/5 shadow-2xl max-w-sm">
                    <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <i className="bi bi-camera-video-fill text-3xl text-emerald-500"></i>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Ready to connect?</h3>
                    <p className="text-gray-400 text-sm mb-6">Start a secure high-definition video session with {selectedUser.username}.</p>
                    <button
                      className="group relative w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-600/20"
                      onClick={initiateCall}
                    >
                      <i className="bi bi-camera-video-fill"></i>
                      <span>Start Video Call</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Incoming call modal-ish overlay */}
              {incomingCall && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-6 transition-all animate-in fade-in duration-300">
                  <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-md"></div>
                  <div className="relative w-full max-w-sm bg-gray-900 rounded-[2.5rem] border border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)] p-8 text-center overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 animate-[shimmer_2s_infinite]"></div>
                    <div className="relative mb-6">
                      <div className="w-24 h-24 mx-auto bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-full flex items-center justify-center shadow-2xl ring-4 ring-emerald-500/20 animate-bounce">
                        <span className="text-3xl font-bold text-white uppercase">{String(incomingCall.name || "?").charAt(0)}</span>
                      </div>
                      <div className="absolute -bottom-2 right-1/2 translate-x-1/2 bg-emerald-500 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase tracking-tighter shadow-lg">Calling...</div>
                    </div>
                    <h3 className="text-2xl font-black text-white mb-1">{incomingCall.name}</h3>
                    <p className="text-gray-400 text-sm font-medium mb-8">is inviting you to a video call</p>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        className="flex flex-col items-center gap-2 p-4 rounded-3xl bg-emerald-500 hover:bg-emerald-400 text-white transition-all shadow-lg shadow-emerald-500/25 group"
                        onClick={handleAcceptCall}
                      >
                        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <i className="bi bi-telephone-fill text-xl"></i>
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider">Accept</span>
                      </button>
                      <button
                        className="flex flex-col items-center gap-2 p-4 rounded-3xl bg-red-500 hover:bg-red-400 text-white transition-all shadow-lg shadow-red-500/25 group"
                        onClick={handleDeclineCall}
                      >
                        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <i className="bi bi-x-lg text-xl"></i>
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider">Decline</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Video Container */}
              {(isPreviewing || isInCall) && (
                <div className="flex-grow relative flex flex-col md:flex-row gap-4 p-4 bg-black overflow-hidden group/container">
                  {/* Remote Video */}
                  <div
                    onClick={onRemoteClick}
                    className={`relative rounded-3xl border border-white/5 bg-gray-900 transition-all duration-500 ease-out cursor-pointer overflow-hidden shadow-2xl flex-grow
                      ${focusedVideo === "remote" ? "md:flex-[3]" : "md:flex-[1] opacity-60 hover:opacity-100 scale-95 hover:scale-100"}`}
                  >
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    ></video>
                    <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">{selectedUser.username}</span>
                    </div>
                  </div>

                  {/* Local Video */}
                  <div
                    onClick={onLocalClick}
                    className={`relative rounded-3xl border border-white/5 bg-gray-900 transition-all duration-500 ease-out cursor-pointer overflow-hidden shadow-2xl flex-grow
                      ${focusedVideo === "local" ? "md:flex-[3]" : "md:flex-[1] opacity-60 hover:opacity-100 scale-95 hover:scale-100"}`}
                  >
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    ></video>
                    <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">You</span>
                    </div>
                  </div>

                  {/* Controls Overlay */}
                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-4 bg-gray-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/10 shadow-2xl transition-all translate-y-2 opacity-0 group-hover/container:translate-y-0 group-hover/container:opacity-100 z-30">
                    <button
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMuted ? "bg-red-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
                      onClick={toggleMute}
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} text-xl`}></i>
                    </button>

                    <button
                      className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-500/20 hover:scale-110 active:scale-95 transition-all"
                      onClick={endCall}
                      title="End Call"
                    >
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
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {showSidebar && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm" onClick={() => setShowSidebar(false)}></div>
          <div className="absolute top-0 left-0 w-80 h-full bg-gray-900 border-r border-white/5 flex flex-col animate-in slide-in-from-left duration-300">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h6 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active Users</h6>
              <button
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all"
                onClick={() => setShowSidebar(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="p-4">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  className="block w-full pl-10 pr-3 py-2 bg-gray-800 border-none rounded-xl text-sm text-white placeholder-gray-500 focus:ring-0"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-grow overflow-y-auto">
              {isLoadingUsers && (
                <div className="p-8 text-center">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <span className="text-xs text-gray-500">Syncing...</span>
                </div>
              )}
              {!isLoadingUsers && usersError && (
                <div className="px-4 py-2 text-xs text-red-400">{usersError}</div>
              )}
              {!isLoadingUsers && !usersError && (
                <div className="space-y-1">
                  {users
                    .filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((user) => (
                      <button
                        key={user._id}
                        className={`w-full flex items-center gap-3 px-4 py-3 transition-all ${selectedUser === user ? "bg-emerald-600/10 border-r-4 border-emerald-500" : "hover:bg-white/5"}`}
                        onClick={() => { setSelectedUser(selectedUser === user ? null : user); setShowSidebar(false); }}
                      >
                        <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-emerald-500">
                          <i className="bi bi-person-fill text-lg"></i>
                        </div>
                        <span className="text-sm font-medium text-gray-200">{user.username}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
