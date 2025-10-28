import React, { createContext, useContext, useState } from "react";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import axios from "axios";

const CallContext = createContext();

export const CallProvider = ({ children }) => {
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  // ✅ Join the LiveKit Room
  const joinRoom = async (userName, roomName) => {
    try {
      // 1️⃣ Fetch the token from your backend
      const res = await axios.post("http://localhost:5000/api/livekit/token", {
        userName,
        roomName,
      });

      // Make sure we only use the token string, not an object
      const token = res.data.token;
      console.log("✅ LiveKit token received:", token);

      if (!token || typeof token !== "string") {
        throw new Error("Invalid token received from backend");
      }

      // 2️⃣ Create and configure the LiveKit room
      const newRoom = new Room();

      newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log("👥 Participant connected:", participant.identity);
        setParticipants((prev) => [...prev, participant]);
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log("🚪 Participant disconnected:", participant.identity);
        setParticipants((prev) =>
          prev.filter((p) => p.identity !== participant.identity)
        );
      });

      newRoom.on(RoomEvent.Disconnected, () => {
        console.log("❌ Disconnected from LiveKit room");
        setIsConnected(false);
        setRoom(null);
        setParticipants([]);
      });

      // 3️⃣ Connect to LiveKit using the token string
      const livekitURL = process.env.REACT_APP_LIVEKIT_URL;
      if (!livekitURL) {
        throw new Error("Missing REACT_APP_LIVEKIT_URL in .env file");
      }

      await newRoom.connect(livekitURL, token);
      setRoom(newRoom);
      setIsConnected(true);
      console.log("✅ Connected to LiveKit room:", roomName);

      // 4️⃣ Publish local audio/video tracks
      const localTracks = await createLocalTracks({ audio: true, video: true });
      for (const track of localTracks) {
        await newRoom.localParticipant.publishTrack(track);
      }

      console.log("🎥 Local tracks published");
    } catch (error) {
      console.error("❌ Error joining LiveKit room:", error);
    }
  };

  // ✅ Leave the room
  const leaveRoom = async () => {
    if (room) {
      await room.disconnect();
      setRoom(null);
      setIsConnected(false);
      setParticipants([]);
      console.log("👋 Left the room");
    }
  };

  return (
    <CallContext.Provider
      value={{
        joinRoom,
        leaveRoom,
        room,
        participants,
        isConnected,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
