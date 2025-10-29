// Home.js
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";

const SOCKET_URL = "http://localhost:5000";
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
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState("idle");
  const [localTracks, setLocalTracks] = useState(null);
  const [focusedVideo, setFocusedVideo] = useState("remote");

  // ✅ new states for mute/camera toggle
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);

  // -------------------- Fetch Users --------------------
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get("http://localhost:5000/api/auth/all-users");
        setUsers(res.data.filter((u) => u.username !== username));
      } catch (err) {
        console.error(err);
      }
    };
    fetchUsers();

    socket.emit("register-user", {
      userId: userId || username,
      userName: username,
    });
  }, [username, userId]);

  // -------------------- Helper: reliable play --------------------
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
    try {
      videoEl.play().catch(() => {});
    } catch (_) {}
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

      if (!tracks || tracks.length === 0) {
        console.warn("⚠️ createLocalTracks returned no tracks");
        return [];
      }

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

  // -------------------- Accept or Join Call --------------------
  const acceptCall = async (roomName, callerName) => {
    try {
      console.log(`📞 Accepting call for room: ${roomName}`);
      const res = await fetch("http://localhost:5000/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, userName: callerName }),
      });
      const data = await res.json();
      if (!data.token) throw new Error("No token received!");

      const livekitRoom = new Room();
      await livekitRoom.connect(LIVEKIT_URL, data.token);

      let tracksToUse = localTracks;
      if (!tracksToUse || tracksToUse.length === 0) {
        tracksToUse = await createLocalTracks({
          audio: true,
          video: { facingMode: "user" },
        });
        setLocalTracks(tracksToUse);
      }

      tracksToUse.forEach((track) => {
        livekitRoom.localParticipant.publishTrack(track);
        if (track.kind === "video" && localVideoRef.current) {
          track.attach(localVideoRef.current);
        }
      });

      livekitRoom.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        console.log("👀 Remote track subscribed:", participant.identity);
        if (track.kind === "video" && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      });

      setCallStatus("connected");
      setRoom(livekitRoom);
      roomRef.current = livekitRoom;
      setIsPreviewing(true);
      setIsInCall(true);
    } catch (error) {
      console.error("❌ Failed to join LiveKit room:", error);
    }
  };

  // -------------------- Initiate Call --------------------
  const initiateCall = async () => {
    if (!selectedUser) return alert("Select a user first.");
    const toUserId = selectedUser._id;
    const fromUserId = userId || username;
    const roomName = `room_${[username, selectedUser.username].sort().join("_")}`;

    setIsCalling(true);
    setCallStatus("calling");

    console.log("🎥 Preparing camera before call...");
    const tracks = await startCameraPreview();

    if (!tracks || tracks.length === 0) {
      alert("Could not start camera. Please check permissions.");
      setIsCalling(false);
      setCallStatus("idle");
      return;
    }

    console.log("📞 Camera ready, now sending call event...");
    socket.emit("call-user", { toUserId, fromUserId, roomName });
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
        setCallStatus("idle");
      }
    });

    return () => {
      socket.off("incoming-call");
      socket.off("call-response");
    };
  }, [username, localTracks]);

  // -------------------- End Call --------------------
  const endCall = () => {
    if (roomRef.current) roomRef.current.disconnect();
    if (localVideoRef.current?.srcObject)
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
    if (remoteVideoRef.current?.srcObject)
      remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
    setLocalTracks(null);
    setIsPreviewing(false);
    setIsInCall(false);
    setIsCalling(false);
    setCallStatus("idle");
    setFocusedVideo("remote");
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;
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

  const onLocalClick = () =>
    setFocusedVideo((prev) => (prev === "local" ? "remote" : "local"));
  const onRemoteClick = () =>
    setFocusedVideo((prev) => (prev === "remote" ? "local" : "remote"));

  // -------------------- JSX --------------------
  return (
    <div className="d-flex vh-100 bg-dark text-light">
      {/* Sidebar */}
      <div className="bg-secondary-subtle border-end border-dark p-3" style={{ width: "240px" }}>
        <h5 className="mb-4 text-center text-primary fw-bold">Users</h5>
        <ul className="list-group">
          {users.map((user) => (
            <li
              key={user._id}
              className={`list-group-item list-group-item-action ${
                selectedUser === user ? "active" : ""
              }`}
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedUser(selectedUser === user ? null : user)}
            >
              <i className="bi bi-person-fill me-2"></i>
              {user.username}
            </li>
          ))}
        </ul>
      </div>

      {/* Main Area */}
      <div className="flex-grow-1 d-flex justify-content-center align-items-center position-relative">
        {!selectedUser && (
          <div className="text-center">
            <h1 className="mb-3 fw-bold text-info">Welcome, {username} 👋</h1>
            <p className="text-secondary mb-4">Select a user to start a video call</p>
            <button className="btn btn-danger" onClick={handleLogout}>
              <i className="bi bi-box-arrow-right me-2"></i>Logout
            </button>
          </div>
        )}

        {selectedUser && (
          <div className="card bg-dark border border-secondary shadow-lg w-100 h-100 p-3 text-light">
            <button
              className="btn btn-sm btn-outline-danger position-absolute"
              style={{ top: 15, right: 15 }}
              onClick={handleLogout}
            >
              <i className="bi bi-box-arrow-right"></i>
            </button>

            <h5 className="mb-3">
              <i className="bi bi-camera-video-fill me-2 text-success"></i>
              Chat with {selectedUser.username}
            </h5>

            <div className="mb-3">
              <span className="badge bg-info text-dark fs-6">
                Status: {callStatus.toUpperCase()}
              </span>
            </div>

            {!room && !incomingCall && !isInCall && (
              <button className="btn btn-success px-4 py-2 fw-semibold" onClick={initiateCall}>
                <i className="bi bi-camera-video me-2"></i>
                Start Video Call
              </button>
            )}

            {incomingCall && (
              <div className="alert alert-info mt-4">
                <strong>📞 Incoming call</strong> from {incomingCall.name}
                <div className="mt-2">
                  <button className="btn btn-success me-2" onClick={handleAcceptCall}>
                    <i className="bi bi-check-circle me-1"></i>Accept
                  </button>
                  <button className="btn btn-danger" onClick={handleDeclineCall}>
                    <i className="bi bi-x-circle me-1"></i>Decline
                  </button>
                </div>
              </div>
            )}

            {(isPreviewing || isInCall) && (
              <div
                className="w-100 h-100 mt-3 d-flex gap-2 align-items-stretch justify-content-center position-relative"
                style={{ backgroundColor: "#000", borderRadius: "10px", overflow: "hidden", padding: 12 }}
              >
                {/* Remote Video */}
                <div
                  onClick={onRemoteClick}
                  className="d-flex align-items-center justify-content-center"
                  style={{
                    transition: "all 230ms ease",
                    cursor: "pointer",
                    flex: focusedVideo === "remote" ? 2 : 1,
                    position: "relative",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <video ref={remoteVideoRef} autoPlay playsInline className="w-100 h-100 rounded object-fit-cover"></video>
                  <div className="position-absolute top-0 start-0 p-2 bg-dark bg-opacity-50 text-white small rounded-end">
                    {selectedUser.username}
                  </div>
                </div>

                {/* Local Video */}
                <div
                  onClick={onLocalClick}
                  className="d-flex align-items-center justify-content-center"
                  style={{
                    transition: "all 230ms ease",
                    cursor: "pointer",
                    flex: focusedVideo === "local" ? 2 : 1,
                    position: "relative",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-100 h-100 rounded object-fit-cover"></video>
                  <div className="position-absolute top-0 start-0 p-2 bg-dark bg-opacity-50 text-white small rounded-end">
                    You
                  </div>
                </div>

                {/* Controls (bottom center) */}
                <div className="position-absolute bottom-0 start-50 translate-middle-x mb-3 d-flex gap-3">
                  {/* End Call */}
                  <button className="btn btn-danger btn-lg rounded-circle shadow" onClick={endCall}>
                    <i className="bi bi-telephone-x-fill fs-4"></i>
                  </button>

                  {/* Toggle Mute */}
                  <button
                    className="btn btn-light btn-lg rounded-circle shadow"
                    onClick={toggleMute}
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    <i className={`bi ${isMuted ? "bi-mic-mute-fill" : "bi-mic-fill"} fs-4 text-dark`}></i>
                  </button>

                  {/* Toggle Video */}
                  <button
                    className="btn btn-light btn-lg rounded-circle shadow"
                    onClick={toggleVideo}
                    title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                  >
                    <i className={`bi ${isVideoOff ? "bi-camera-video-off-fill" : "bi-camera-video-fill"} fs-4 text-dark`}></i>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
