import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("/api/auth/login", { email, password });
      localStorage.setItem("userId", res.data.id);
      localStorage.setItem("username", res.data.username);
      navigate("/home");
    } catch (err) {
      console.error("Login Error:", err);
      const errorMessage = err.response?.data?.error || err.message || JSON.stringify(err);
      alert(`Login failed: ${errorMessage}`);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center vh-100 bg-light">
      <div className="card shadow p-4" style={{ width: "22rem" }}>
        <h2 className="text-center mb-4">Login</h2>
        <form onSubmit={handleLogin}>
          <input type="email" className="form-control mb-3" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" className="form-control mb-3" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" className="btn btn-primary w-100">Login</button>
        </form>

        <div className="mt-4 p-2 border rounded bg-light small">
          <p className="fw-bold mb-1">🔧 Mobile Debugger</p>
          <p className="mb-1 text-break">URL: {window.location.origin}</p>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary w-100 mb-2"
            onClick={async () => {
              try {
                alert(`Testing connection to: ${window.location.origin}/debug-files`);
                const res = await axios.get("/debug-files");
                alert(`✅ Server Reachable!\nData: ${JSON.stringify(res.data).slice(0, 100)}...`);
              } catch (e) {
                alert(`❌ Server Connection Failed:\n${e.message}\n${JSON.stringify(e)}`);
              }
            }}
          >
            Test Connection
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;
