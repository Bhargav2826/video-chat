// Home.js
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";

const SOCKET_URL = "http://localhost:5000";
const socket = io(SOCKET_URL, { autoConnect: true });

function Home() {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "Guest";
  const userId = localStorage.getItem("userId");

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [room, setRoom] = useState(null);

  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const roomRef = useRef(null);
  const localTracksRef = useRef([]);

  // --------------------
  // Fetch users and register socket
  // --------------------
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

    socket.emit("register-user", { userId: userId || username, userName: username });
  }, [username, userId]);

  // --------------------
  // Join LiveKit room safely
  // --------------------
  const joinLiveKitRoom = useCallback(async (roomName) => {
    try {
      const res = await axios.post("http://localhost:5000/api/livekit/token", {
        userName: username,
        roomName,
      });

      const { token, url } = res.data;
      if (!token || !url) throw new Error("LiveKit token or URL missing");

      const livekitRoom = new Room();
      await livekitRoom.connect(url, token.toString());
      setRoom(livekitRoom);
      roomRef.current = livekitRoom;

      // Create local tracks
      const tracks = await createLocalTracks({ audio: true, video: true });
      localTracksRef.current = tracks;

      for (const track of tracks) {
        await livekitRoom.localParticipant.publishTrack(track);
        if (track.kind === "video" && localVideoRef.current) track.attach(localVideoRef.current);
      }

      // Subscribe to remote participant tracks
      livekitRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        participant.tracks.forEach((pub) => {
          if (pub.isSubscribed && pub.track && pub.track.kind === "video") {
            pub.track.attach(remoteVideoRef.current);
          }
        });

        participant.on("trackSubscribed", (track) => {
          if (track.kind === "video") track.attach(remoteVideoRef.current);
        });
      });

      livekitRoom.on(RoomEvent.Disconnected, () => {
        cleanupTracks();
        setRoom(null);
      });
    } catch (err) {
      console.error("Failed to join LiveKit room:", err);
      alert("Could not connect to call. Check console for details.");
    }
  }, [username]);

  // --------------------
  // Socket event listeners
  // --------------------
  useEffect(() => {
    socket.on("incoming-call", ({ fromUserId, fromUserName, roomName }) => {
      setIncomingCall({ id: fromUserId, name: fromUserName, roomName });
      console.log("📩 Incoming call:", fromUserName, roomName);
    });

    socket.on("call-response", ({ accepted, roomName }) => {
      if (accepted) joinLiveKitRoom(roomName);
      else alert("Call declined by user.");
      console.log("📲 Call response:", accepted, roomName);
    });

    return () => {
      socket.off("incoming-call");
      socket.off("call-response");
    };
  }, [joinLiveKitRoom]);

  // --------------------
  // Logout
  // --------------------
  const handleLogout = () => {
    localStorage.clear();
    navigate("/login");
  };

  // --------------------
  // Call functions
  // --------------------
  const initiateCall = () => {
    if (!selectedUser) return alert("Select a user first.");
    const toUserId = selectedUser._id;
    const fromUserId = userId || username;
    const roomName = `room_${[username, selectedUser.username].sort().join("_")}`;

    socket.emit("call-user", { toUserId, fromUserId, roomName });
    alert(`Calling ${selectedUser.username}... waiting for acceptance.`);
  };

  const acceptCall = () => {
    if (!incomingCall) return;
    socket.emit("call-response", { toUserId: incomingCall.id, accepted: true, roomName: incomingCall.roomName });
    setIncomingCall(null);
    joinLiveKitRoom(incomingCall.roomName);
  };

  const declineCall = () => {
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
    localTracksRef.current.forEach((track) => track.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  // --------------------
  // JSX
  // --------------------
  return (
    <div className="d-flex vh-100 bg-light">
      <div className="bg-white shadow p-3" style={{ width: "220px" }}>
        <h5 className="mb-3">Registered Users</h5>
        <ul className="list-group">
          {users.map((user) => (
            <li key={user._id}
                className={`list-group-item ${selectedUser === user ? "active" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedUser(selectedUser === user ? null : user)}>
              {user.username}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-grow-1 d-flex justify-content-center align-items-center position-relative">
        {!selectedUser && <div className="card shadow p-5 w-100 h-100">
          <button className="btn btn-sm btn-danger position-absolute" style={{ top: 10, right: 10 }} onClick={handleLogout}>Logout</button>
          <h1 className="mb-3 text-center">Hello, {username} 👋</h1>
          <p className="text-secondary text-center">Welcome to your dashboard</p>
        </div>}

        {selectedUser && <div className="card shadow position-relative w-100 h-100 p-3">
          <button className="btn btn-sm btn-danger position-absolute" style={{ top: 10, right: 10 }} onClick={handleLogout}>Logout</button>
          <h5>Chat with {selectedUser.username}</h5>

          {!room && !incomingCall && <button className="btn btn-success my-2" onClick={initiateCall}>Start Video Call</button>}

          {incomingCall && <div className="alert alert-info mt-3">
            Incoming call from <strong>{incomingCall.name}</strong>
            <div className="mt-2">
              <button className="btn btn-sm btn-primary me-2" onClick={acceptCall}>Accept</button>
              <button className="btn btn-sm btn-danger" onClick={declineCall}>Decline</button>
            </div>
          </div>}

          {room && <div className="d-flex justify-content-center align-items-center mt-3 w-100 h-100">
            <video ref={localVideoRef} autoPlay muted style={{ width: "50%", marginRight: "10px" }} />
            <video ref={remoteVideoRef} autoPlay style={{ width: "50%" }} />
            <div className="position-absolute" style={{ bottom: 20, right: 20 }}>
              <button className="btn btn-danger" onClick={endCall}>End Call</button>
            </div>
          </div>}
        </div>}
      </div>
    </div>
  );
}

export default Home;
