// Home.js
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import "bootstrap/dist/css/bootstrap.min.css";
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
    <div className="vh-100 d-flex flex-column bg-dark text-light">
      {/* Navbar */}
      <nav className="navbar navbar-dark bg-success px-3">
        <span className="navbar-brand d-flex align-items-center gap-2">
          <span className="fw-semibold">Chats</span>
        </span>
        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-outline-secondary btn-sm d-lg-none" onClick={() => setShowSidebar(true)}>
            <i className="bi bi-people-fill me-1"></i>Users
          </button>
          <span className="badge bg-light text-dark">{username}</span>
          <button className="btn btn-outline-danger btn-sm" onClick={handleLogout}>
            <i className="bi bi-box-arrow-right me-1"></i>Logout
          </button>
        </div>
      </nav>

      <div className="flex-grow-1 d-flex overflow-hidden">
        {/* Sidebar */}
        <div className="bg-dark border-end border-secondary-subtle p-0 d-none d-lg-flex flex-column" style={{ width: "320px" }}>
          <div className="p-3 border-bottom border-secondary-subtle">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-secondary-subtle text-dark border-0 rounded-start-pill">
                <i className="bi bi-search"></i>
              </span>
              <input className="form-control bg-secondary-subtle text-dark border-0 rounded-end-pill" placeholder="Search or start new chat" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
          {isLoadingUsers && (
            <div className="text-secondary small d-flex align-items-center gap-2">
              <div className="spinner-border spinner-border-sm text-secondary" role="status"></div>
              Loading users...
            </div>
          )}
          {!isLoadingUsers && usersError && (
            <div className="alert alert-danger py-2 small">{usersError}</div>
          )}
          {!isLoadingUsers && !usersError && (
            <ul className="list-group list-group-flush small" style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
              {users
                .filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((user) => (
                  <li
                    key={user._id}
                    className={`list-group-item bg-dark text-light border-secondary-subtle list-group-item-action ${selectedUser === user ? "active bg-secondary text-white" : ""}`}
                    style={{ cursor: "pointer", padding: "12px 16px" }}
                    onClick={() => setSelectedUser(selectedUser === user ? null : user)}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <div className="rounded-circle bg-success d-flex align-items-center justify-content-center" style={{ width: 36, height: 36 }}>
                        <span className="text-white fw-semibold">{String(user.username || "?").charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-grow-1">
                        <div className="d-flex justify-content-between">
                          <strong className="text-light">{user.username}</strong>
                          <small className="text-secondary">online</small>
                        </div>
                        <div className="text-secondary small">Tap to start call</div>
                      </div>
                    </div>
                  </li>
                ))}
              {users.filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                <li className="list-group-item bg-transparent text-secondary border-secondary">No users found</li>
              )}
            </ul>
          )}
        </div>

        {/* Main Area */}
        <div className="flex-grow-1 d-flex justify-content-center align-items-center position-relative p-3">
          {!selectedUser && (
            <div className="text-center">
              <h1 className="mb-2 fw-bold text-info">Welcome, {username} 👋</h1>
              <p className="text-secondary mb-4">Select a user from the left to start a video call</p>
            </div>
          )}

          {selectedUser && (
            <div className="card bg-dark border-0 w-100 h-100 text-light">
              <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom border-secondary-subtle" style={{ backgroundColor: "#128C7E" }}>
                <div className="d-flex align-items-center gap-2">
                  <div className="rounded-circle bg-light d-flex align-items-center justify-content-center" style={{ width: 36, height: 36 }}>
                    <span className="text-dark fw-semibold">{String(selectedUser.username || "?").charAt(0).toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="fw-semibold">{selectedUser.username}</div>
                    <small className="text-white-50">{callStatus === "connected" ? "In call" : callStatus}</small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button className="btn btn-outline-light btn-sm" onClick={initiateCall} disabled={!!room || isInCall || isPreviewing}>
                    <i className="bi bi-camera-video"></i>
                  </button>
                  <button className="btn btn-outline-light btn-sm" onClick={endCall} disabled={!isInCall && !isPreviewing}>
                    <i className="bi bi-telephone-x"></i>
                  </button>
                </div>
              </div>

              {/* Start Call CTA */}
              {!room && !incomingCall && !isInCall && !isPreviewing && (
                <div className="py-3">
                  <button className="btn btn-success px-4 py-2 fw-semibold" onClick={initiateCall}>
                    <i className="bi bi-camera-video me-2"></i>
                    Start Video Call
                  </button>
                </div>
              )}

              {/* Incoming call modal-ish overlay */}
              {incomingCall && (
                <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: "rgba(0,0,0,0.6)" }}>
                  <div className="card bg-black border border-secondary p-3" style={{ maxWidth: 420 }}>
                    <div className="d-flex align-items-center mb-2">
                      <i className="bi bi-telephone-inbound-fill text-info me-2"></i>
                      <strong>Incoming call</strong>
                    </div>
                    <div className="mb-3 text-secondary">From: <span className="text-light">{incomingCall.name}</span></div>
                    <div className="d-flex gap-2">
                      <button className="btn btn-success flex-fill" onClick={handleAcceptCall}>
                        <i className="bi bi-check-circle me-1"></i>Accept
                      </button>
                      <button className="btn btn-danger flex-fill" onClick={handleDeclineCall}>
                        <i className="bi bi-x-circle me-1"></i>Decline
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Video Container */}
              {(isPreviewing || isInCall) && (
                <div
                  className="w-100 h-100 d-flex gap-2 align-items-stretch justify-content-center position-relative"
                  style={{ backgroundColor: "#0b141a", overflow: "hidden", padding: 12, backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
                >
                  {/* Remote Video */}
                  <div
                    onClick={onRemoteClick}
                    className="d-flex align-items-center justify-content-center position-relative rounded-3 border border-secondary-subtle"
                    style={{ transition: "all 230ms ease", cursor: "pointer", flex: focusedVideo === "remote" ? 2 : 1, overflow: "hidden" }}
                  >
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-100 h-100 rounded object-fit-cover"
                    ></video>
                    <div className="position-absolute top-0 start-0 p-2 bg-dark bg-opacity-50 text-white small rounded-end">
                      {selectedUser.username}
                    </div>
                  </div>

                  {/* Local Video */}
                  <div
                    onClick={onLocalClick}
                    className="d-flex align-items-center justify-content-center position-relative rounded-3 border border-secondary-subtle"
                    style={{ transition: "all 230ms ease", cursor: "pointer", flex: focusedVideo === "local" ? 2 : 1, overflow: "hidden" }}
                  >
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-100 h-100 rounded object-fit-cover"
                    ></video>
                    <div className="position-absolute top-0 start-0 p-2 bg-dark bg-opacity-50 text-white small rounded-end">
                      You
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="position-absolute bottom-0 start-50 translate-middle-x mb-3 d-flex gap-2">
                    <button className="btn btn-danger rounded-circle shadow d-flex align-items-center justify-content-center" style={{ width: 54, height: 54 }} onClick={endCall}>
                      <i className="bi bi-telephone-x-fill fs-5"></i>
                    </button>

                    <button
                      className="btn btn-light rounded-circle shadow d-flex align-items-center justify-content-center"
                      style={{ width: 54, height: 54 }}
                      onClick={toggleMute}
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} fs-5 text-dark`}></i>
                    </button>

                    <button
                      className="btn btn-light rounded-circle shadow d-flex align-items-center justify-content-center"
                      style={{ width: 54, height: 54 }}
                      onClick={toggleVideo}
                      title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                    >
                      <i className={`bi ${isVideoOff ? "bi-camera-video-off-fill" : "bi-camera-video-fill"} fs-5 text-dark`}></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showSidebar && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-lg-none" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="bg-dark border-start border-secondary h-100 ms-auto p-3" style={{ width: 300 }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="mb-0 text-secondary text-uppercase">Users</h6>
              <button className="btn btn-outline-light btn-sm" onClick={() => setShowSidebar(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="input-group input-group-sm mb-3">
              <span className="input-group-text bg-dark text-light border-secondary">
                <i className="bi bi-search"></i>
              </span>
              <input className="form-control bg-dark text-light border-secondary" placeholder="Search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            {isLoadingUsers && (
              <div className="text-secondary small d-flex align-items-center gap-2">
                <div className="spinner-border spinner-border-sm text-secondary" role="status"></div>
                Loading users...
              </div>
            )}
            {!isLoadingUsers && usersError && (
              <div className="alert alert-danger py-2 small">{usersError}</div>
            )}
            {!isLoadingUsers && !usersError && (
              <ul className="list-group list-group-flush small" style={{ maxHeight: "calc(100vh - 150px)", overflowY: "auto" }}>
                {users
                  .filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((user) => (
                    <li
                      key={user._id}
                      className={`list-group-item bg-transparent text-light border-secondary list-group-item-action ${selectedUser === user ? "active bg-primary text-white" : ""}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => { setSelectedUser(selectedUser === user ? null : user); setShowSidebar(false); }}
                    >
                      <i className="bi bi-person-fill me-2"></i>
                      {user.username}
                    </li>
                  ))}
                {users.filter((u) => u.username.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                  <li className="list-group-item bg-transparent text-secondary border-secondary">No users found</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
