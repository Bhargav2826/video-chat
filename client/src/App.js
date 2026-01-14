import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Home from "./pages/Home";
import { CallProvider, useCall } from "./context/CallContext";
// -----------------------------
// Video Call Page Component
// -----------------------------
const VideoCallUI = () => {
  const { registerUser, callUser, respondToCall, incomingCall, inCall } = useCall();
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [roomName, setRoomName] = useState("");

  const handleRegister = () => {
    if (!userId || !userName) return alert("Enter your ID and Name first!");
    registerUser(userId, userName);
  };

  const handleCall = () => {
    if (!targetId || !roomName) return alert("Enter target user & room name");
    callUser(targetId, roomName);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto text-center bg-gray-900 text-white rounded-3xl mt-10 shadow-2xl border border-white/10">
      <h1 className="text-4xl font-black mb-8 bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">🎥 LiveKit Video Call</h1>

      {!inCall ? (
        <div className="space-y-8">
          <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 space-y-4">
            <h3 className="text-left text-xs font-bold text-gray-500 uppercase tracking-widest pl-2">Session Identity</h3>
            <input
              className="w-full px-5 py-4 bg-gray-800 border-none rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              placeholder="Your User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <input
              className="w-full px-5 py-4 bg-gray-800 border-none rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
            <button
              onClick={handleRegister}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
              Secure Register
            </button>
          </div>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
            <div className="relative flex justify-center"><span className="bg-gray-900 px-4 text-xs font-bold text-gray-600 uppercase tracking-widest">Connect</span></div>
          </div>

          <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 space-y-4">
            <h3 className="text-left text-xs font-bold text-gray-500 uppercase tracking-widest pl-2">Remote Peer</h3>
            <input
              className="w-full px-5 py-4 bg-gray-800 border-none rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              placeholder="Target User ID"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
            <input
              className="w-full px-5 py-4 bg-gray-800 border-none rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              placeholder="Room Name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
            <button
              onClick={handleCall}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
              Initialize Handshake
            </button>
          </div>

          {incomingCall && (
            <div className="p-6 bg-blue-500/10 border border-blue-500/20 rounded-[2rem] animate-pulse">
              <p className="text-lg font-bold text-blue-400 mb-4 tracking-tight">
                📞 Signaling from <span className="text-blue-100 uppercase">{incomingCall.fromUserName}</span>
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => respondToCall(true, incomingCall.roomName, incomingCall.fromUserId)}
                  className="flex-grow py-3 bg-blue-500 text-white font-bold rounded-xl shadow-lg"
                >
                  Confirm
                </button>
                <button
                  onClick={() => respondToCall(false, incomingCall.roomName, incomingCall.fromUserId)}
                  className="flex-grow py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-20 animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-2xl font-black text-blue-400 tracking-tighter">ESTABLISHED ENCRYPTED CHANNEL</p>
        </div>
      )}
    </div>
  );
};

// -----------------------------
// Main App
// -----------------------------
function App() {
  return (
    <CallProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/home" element={<Home />} />

          {/* New video call test route */}
          <Route path="/call" element={<VideoCallUI />} />
        </Routes>
      </Router>
    </CallProvider>
  );
}

export default App;
