import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Home from "./pages/Home";
import { CallProvider, useCall } from "./context/CallContext";
import "bootstrap/dist/css/bootstrap.min.css";

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
    <div className="p-4 container text-center">
      <h1 className="text-2xl fw-bold mb-3">🎥 LiveKit Video Call</h1>

      {!inCall ? (
        <>
          <div className="mb-3">
            <input
              className="form-control mb-2"
              placeholder="Your User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <input
              className="form-control mb-2"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
            <button
              onClick={handleRegister}
              className="btn btn-primary w-100"
            >
              Register
            </button>
          </div>

          <hr />

          <div className="mb-3">
            <input
              className="form-control mb-2"
              placeholder="Target User ID"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
            <input
              className="form-control mb-2"
              placeholder="Room Name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
            <button
              onClick={handleCall}
              className="btn btn-success w-100"
            >
              Call User
            </button>
          </div>

          {incomingCall && (
            <div className="alert alert-info mt-4">
              <p>
                📞 Incoming call from <b>{incomingCall.fromUserName}</b>
              </p>
              <button
                onClick={() =>
                  respondToCall(true, incomingCall.roomName, incomingCall.fromUserId)
                }
                className="btn btn-success mx-2"
              >
                Accept
              </button>
              <button
                onClick={() =>
                  respondToCall(false, incomingCall.roomName, incomingCall.fromUserId)
                }
                className="btn btn-danger mx-2"
              >
                Reject
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-success fs-5 fw-bold mt-4">✅ In Call</p>
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
          <Route path="/" element={<Navigate to="/login" />} />
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
