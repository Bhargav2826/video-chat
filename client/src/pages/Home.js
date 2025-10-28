import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";

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

  // -------------------- Start Camera Preview --------------------
  const startCameraPreview = async () => {
    try {
      const localTracks = await createLocalTracks({
        audio: true,
        video: { facingMode: "user" },
      });
      const videoTrack = localTracks.find((t) => t.kind === "video");
      if (videoTrack && localVideoRef.current) {
        const videoEl = videoTrack.attach();
        localVideoRef.current.srcObject = videoEl.srcObject || videoEl.captureStream?.();
      }
      setIsPreviewing(true);
      console.log("🎥 Local preview started");
      return localTracks;
    } catch (err) {
      console.error("⚠️ Could not start camera preview:", err);
      alert("Please allow camera/microphone access.");
      return [];
    }
  };

  // -------------------- Accept or Join Call --------------------
  const acceptCall = async (roomName) => {
    try {
      console.log(`📞 Accepting call for room: ${roomName}`);

      const res = await fetch("http://localhost:5000/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, userName: username }),
      });
      const data = await res.json();
      if (!data.token) throw new Error("No token received!");

      const livekitRoom = new Room();
      await livekitRoom.connect(LIVEKIT_URL, data.token);
      console.log("✅ Connected to LiveKit");

      const localTracks = await createLocalTracks({
        audio: true,
        video: { facingMode: "user" },
      });

      // Attach local camera to preview
      localTracks.forEach((track) => {
        livekitRoom.localParticipant.publishTrack(track);
        if (track.kind === "video" && localVideoRef.current) {
          const videoEl = track.attach();
          localVideoRef.current.srcObject = videoEl.srcObject || videoEl.captureStream?.();
        }
      });

      // Remote participant's video
      livekitRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === "video" && remoteVideoRef.current) {
          const videoEl = track.attach();
          remoteVideoRef.current.srcObject = videoEl.srcObject || videoEl.captureStream?.();
        }
      });

      setRoom(livekitRoom);
      roomRef.current = livekitRoom;
      setIsPreviewing(true);
      setIsInCall(true);
    } catch (error) {
      console.error("❌ Failed to join LiveKit room:", error);
    }
  };

  // -------------------- Caller Initiates Call --------------------
  const initiateCall = async () => {
    if (!selectedUser) return alert("Select a user first.");
    const toUserId = selectedUser._id;
    const fromUserId = userId || username;
    const roomName = `room_${[username, selectedUser.username].sort().join("_")}`;

    setIsCalling(true);
    await startCameraPreview();

    socket.emit("call-user", { toUserId, fromUserId, roomName });
    alert(`📞 Calling ${selectedUser.username}... waiting for acceptance.`);
  };

  // -------------------- Socket Events --------------------
  useEffect(() => {
    socket.on("incoming-call", ({ fromUserId, fromUserName, roomName }) => {
      setIncomingCall({ id: fromUserId, name: fromUserName, roomName });
      console.log("📩 Incoming call:", fromUserName, roomName);
    });

    socket.on("call-response", ({ accepted, roomName }) => {
      console.log("📲 Call response:", accepted, roomName);
      if (accepted) acceptCall(roomName);
      else alert("Call declined by user.");
    });

    return () => {
      socket.off("incoming-call");
      socket.off("call-response");
    };
  }, [username]);

  // -------------------- End Call --------------------
  const endCall = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      setRoom(null);
    }
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current?.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      remoteVideoRef.current.srcObject = null;
    }
    setIsPreviewing(false);
    setIsInCall(false);
    setIsCalling(false);
  };

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
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/login");
  };

  // -------------------- JSX --------------------
  return (
    <div className="d-flex vh-100 bg-light">
      {/* Sidebar */}
      <div className="bg-white shadow p-3" style={{ width: "220px" }}>
        <h5 className="mb-3">Registered Users</h5>
        <ul className="list-group">
          {users.map((user) => (
            <li
              key={user._id}
              className={`list-group-item ${selectedUser === user ? "active" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedUser(selectedUser === user ? null : user)}
            >
              {user.username}
            </li>
          ))}
        </ul>
      </div>

      {/* Main Area */}
      <div className="flex-grow-1 d-flex justify-content-center align-items-center position-relative">
        {!selectedUser && (
          <div className="card shadow p-5 w-100 h-100">
            <button
              className="btn btn-sm btn-danger position-absolute"
              style={{ top: 10, right: 10 }}
              onClick={handleLogout}
            >
              Logout
            </button>
            <h1 className="mb-3 text-center">Hello, {username} 👋</h1>
            <p className="text-secondary text-center">Welcome to your dashboard</p>
          </div>
        )}

        {selectedUser && (
          <div className="card shadow position-relative w-100 h-100 p-3">
            <button
              className="btn btn-sm btn-danger position-absolute"
              style={{ top: 10, right: 10 }}
              onClick={handleLogout}
            >
              Logout
            </button>
            <h5>Chat with {selectedUser.username}</h5>

            {!room && !incomingCall && !isInCall && (
              <button className="btn btn-success my-2" onClick={initiateCall}>
                Start Video Call
              </button>
            )}

            {incomingCall && (
              <div className="alert alert-info mt-3">
                Incoming call from <strong>{incomingCall.name}</strong>
                <div className="mt-2">
                  <button className="btn btn-sm btn-primary me-2" onClick={handleAcceptCall}>
                    Accept
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={handleDeclineCall}>
                    Decline
                  </button>
                </div>
              </div>
            )}

            {(isPreviewing || isInCall) && (
              <div className="row w-100 h-100 mt-2">
                <div className="col-md-6 d-flex justify-content-center align-items-center bg-dark">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="rounded w-100 h-100 object-fit-cover"
                  ></video>
                </div>
                <div className="col-md-6 d-flex justify-content-center align-items-center bg-secondary">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="rounded w-100 h-100 object-fit-cover"
                  ></video>
                </div>

                <div className="position-absolute" style={{ bottom: 20, right: 20 }}>
                  <button className="btn btn-danger" onClick={endCall}>
                    End Call
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
