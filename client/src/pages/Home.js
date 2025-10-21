import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";

const Home = () => {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [room, setRoom] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const userName = localStorage.getItem("username") || "Guest";

  // ✅ Fetch all users except logged-in user
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get("http://localhost:5000/api/auth/all-users");
        setUsers(res.data.filter((u) => u.username !== userName));
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    };
    fetchUsers();
  }, [userName]);

  // ✅ Start LiveKit call
  const startCall = async (callee) => {
    try {
      setSelectedUser(callee);
      const roomName = `room_${[userName, callee.username].sort().join("_")}`;

      // Get token from backend
      const res = await axios.post("http://localhost:5000/api/livekit/token", {
        userName,
        roomName,
      });

      const { token } = res.data;

      // Connect to LiveKit
      const livekitRoom = new Room();
      await livekitRoom.connect(process.env.REACT_APP_LIVEKIT_URL, token);
      setRoom(livekitRoom);

      // 🎥 Local video + mic
      const tracks = await createLocalTracks({ audio: true, video: true });
      tracks.forEach((track) => livekitRoom.localParticipant.publishTrack(track));

      const videoTrack = tracks.find((t) => t.kind === "video");
      if (videoTrack && localVideoRef.current) {
        videoTrack.attach(localVideoRef.current);
      }

      // 🎥 Remote participant
      livekitRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === "video" && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      });

      // 🧹 Cleanup
      livekitRoom.on(RoomEvent.Disconnected, () => {
        setRoom(null);
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      });
    } catch (error) {
      console.error("Error starting call:", error);
    }
  };

  const leaveCall = () => {
    if (room) {
      room.disconnect();
      setRoom(null);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-1/4 bg-gray-900 text-white p-4 overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">All Users</h2>
        {users.map((user) => (
          <div
            key={user._id}
            className={`p-2 cursor-pointer rounded-md hover:bg-gray-700 ${
              selectedUser && selectedUser._id === user._id ? "bg-gray-700" : ""
            }`}
            onClick={() => setSelectedUser(user)}
          >
            {user.username}
          </div>
        ))}
      </div>

      {/* Main Area */}
      <div className="flex-1 bg-gray-100 flex flex-col justify-center items-center">
        {!room ? (
          <>
            {selectedUser ? (
              <>
                <h2 className="text-xl mb-4">
                  Chatting with <b>{selectedUser.username}</b>
                </h2>
                <button
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  onClick={() => startCall(selectedUser)}
                >
                  Start Video Call
                </button>
              </>
            ) : (
              <p>Select a user to start chatting or call</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center">
            <div className="flex gap-4">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                className="w-72 h-56 bg-black rounded-xl"
              />
              <video
                ref={remoteVideoRef}
                autoPlay
                className="w-72 h-56 bg-black rounded-xl"
              />
            </div>
            <button
              className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              onClick={leaveCall}
            >
              End Call
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
