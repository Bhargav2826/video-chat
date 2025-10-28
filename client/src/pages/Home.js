// Home.js
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent } from "livekit-client";

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

  // ✅ Improved acceptCall()
  const acceptCall = async (roomName, callerName) => {
    try {
      console.log(`📞 Accepting call for room: ${roomName}`);

      const res = await fetch("http://localhost:5000/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, userName: callerName }),
      });

      const data = await res.json();
      if (!data.token) throw new Error("No token received from backend!");

      console.log("✅ LiveKit token received:", data.token);

      const livekitRoom = new Room();

      livekitRoom.on(RoomEvent.Connected, () => {
        console.log("🎥 Connected to LiveKit room successfully!");
      });

      livekitRoom.on(RoomEvent.Disconnected, () => {
        console.log("❌ Disconnected from LiveKit room");
        cleanupTracks();
        setRoom(null);
      });

      await livekitRoom.connect(LIVEKIT_URL, data.token);

      // ✅ Enable mic and camera
      await livekitRoom.localParticipant.setMicrophoneEnabled(true);
      await livekitRoom.localParticipant.setCameraEnabled(true);

      // ✅ Listen for late local track publications
      livekitRoom.localParticipant.on("trackPublished", (pub) => {
        if (pub.kind === "video" && pub.track && localVideoRef.current) {
          const videoEl = pub.track.attach();
          localVideoRef.current.srcObject = videoEl.srcObject;
          console.log("📷 Local track attached dynamically");
        }
      });

      // ✅ Try attaching immediately if tracks exist
      const videoTracks = livekitRoom.localParticipant?.videoTracks;
      if (videoTracks && typeof videoTracks.forEach === "function") {
        videoTracks.forEach((pub) => {
          if (pub.track && localVideoRef.current) {
            const videoEl = pub.track.attach();
            localVideoRef.current.srcObject = videoEl.srcObject;
            console.log("📹 Local track attached immediately");
          }
        });
      } else {
        console.warn("⚠️ No local video tracks available yet.");
      }

      console.log("Local tracks:", livekitRoom.localParticipant.videoTracks);

      // ✅ Handle remote participants joining later
      livekitRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log("👥 Remote participant joined:", participant.identity);

        participant.on("trackSubscribed", (track) => {
          if (track.kind === "video" && remoteVideoRef.current) {
            const videoEl = track.attach();
            remoteVideoRef.current.srcObject = videoEl.srcObject;
            console.log("🎥 Remote video attached");
          }
        });
      });

      // ✅ Handle already connected participants
      if (livekitRoom.participants && livekitRoom.participants.size > 0) {
        console.log(
          "🧩 Existing participants:",
          [...livekitRoom.participants.keys()]
        );

        livekitRoom.participants.forEach((participant) => {
          const trackPublications = participant.tracks
            ? Array.from(participant.tracks.values())
            : [];

          trackPublications.forEach((pub) => {
            if (pub.track && remoteVideoRef.current && pub.track.kind === "video") {
              const videoEl = pub.track.attach();
              remoteVideoRef.current.srcObject = videoEl.srcObject;
              console.log("🎞️ Attached pre-existing remote video track");
            }
          });
        });
      } else {
        console.log("ℹ️ No existing participants at the moment (will join soon).");
      }

      // ✅ Store room reference
      roomRef.current = livekitRoom;
      setRoom(livekitRoom);
    } catch (error) {
      console.error("❌ Failed to join LiveKit room:", error);
      alert("Could not connect to call. Check console for details.");
    }
  };

  // -------------------- Socket Events --------------------
  useEffect(() => {
    socket.on("incoming-call", ({ fromUserId, fromUserName, roomName }) => {
      setIncomingCall({ id: fromUserId, name: fromUserName, roomName });
      console.log("📩 Incoming call:", fromUserName, roomName);
    });

    socket.on("call-response", ({ accepted, roomName }) => {
      if (accepted) acceptCall(roomName, username);
      else alert("Call declined by user.");
      console.log("📲 Call response:", accepted, roomName);
    });

    return () => {
      socket.off("incoming-call");
      socket.off("call-response");
    };
  }, [username]);

  // -------------------- Logout --------------------
  const handleLogout = () => {
    localStorage.clear();
    navigate("/login");
  };

  // -------------------- Call functions --------------------
  const initiateCall = () => {
    if (!selectedUser) return alert("Select a user first.");
    const toUserId = selectedUser._id;
    const fromUserId = userId || username;
    const roomName = `room_${[username, selectedUser.username]
      .sort()
      .join("_")}`;

    socket.emit("call-user", { toUserId, fromUserId, roomName });
    alert(`Calling ${selectedUser.username}... waiting for acceptance.`);
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    socket.emit("call-response", {
      toUserId: incomingCall.id,
      accepted: true,
      roomName: incomingCall.roomName,
    });
    setIncomingCall(null);
    acceptCall(incomingCall.roomName, username);
  };

  const handleDeclineCall = () => {
    if (!incomingCall) return;
    socket.emit("call-response", { toUserId: incomingCall.id, accepted: false });
    setIncomingCall(null);
  };

  const endCall = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      setRoom(null);
      cleanupTracks();
    }
  };

  const cleanupTracks = () => {
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
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
              className={`list-group-item ${
                selectedUser === user ? "active" : ""
              }`}
              style={{ cursor: "pointer" }}
              onClick={() =>
                setSelectedUser(selectedUser === user ? null : user)
              }
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
            <p className="text-secondary text-center">
              Welcome to your dashboard
            </p>
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

            {!room && !incomingCall && (
              <button className="btn btn-success my-2" onClick={initiateCall}>
                Start Video Call
              </button>
            )}

            {incomingCall && (
              <div className="alert alert-info mt-3">
                Incoming call from <strong>{incomingCall.name}</strong>
                <div className="mt-2">
                  <button
                    className="btn btn-sm btn-primary me-2"
                    onClick={handleAcceptCall}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={handleDeclineCall}
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}

            {room && (
              <div className="video-container d-flex justify-content-center align-items-center mt-3 w-100 h-100">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="local-video"
                  style={{ width: "50%", marginRight: "10px" }}
                />
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="remote-video"
                  style={{ width: "50%" }}
                />
                <div
                  className="position-absolute"
                  style={{ bottom: 20, right: 20 }}
                >
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
