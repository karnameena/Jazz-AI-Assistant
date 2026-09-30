import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BatteryCharging,
  Camera,
  ChevronRight,
  CircleDot,
  Crosshair,
  Download,
  ExternalLink,
  Gauge,
  LocateFixed,
  LockKeyhole,
  LogOut,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
  Wifi,
} from "lucide-react";
import "./styles.css";

type LocationState = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  timestamp?: number | string | null;
};

type PhotoState = {
  dataUrl: string;
  camera?: string | null;
  timestamp?: number | string | null;
};

type Device = {
  id: number;
  deviceId?: string;
  deviceName: string;
  deviceType: string;
  online: boolean;
  battery: number | null;
  charging?: boolean;
  network: string;
  lastSeen: string | null;
  mode: string;
  location: LocationState | null;
  photo: PhotoState | null;
};

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function mapEmbedUrl(location: LocationState) {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const spread = 0.006;
  const bbox = [lon - spread, lat - spread, lon + spread, lat + spread].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

function googleMapsUrl(location: LocationState) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function Login({ done }: { done: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="auth-card glass-panel">
        <div className="brand-mark"><Sparkles size={28} /></div>
        <div className="eyebrow">JAZZ SECURE RECOVERY</div>
        <h1>Lost Mode</h1>
        <p className="auth-subtitle">Secure access to your registered recovery devices.</p>
        <form onSubmit={submit} className="auth-form">
          <label>
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Enter username" />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" type="password" placeholder="Enter password" />
          </label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary-button full-width" type="submit"><LockKeyhole size={18} /> Enter Lost Mode</button>
        </form>
        <div className="secure-note"><ShieldCheck size={16} /> Owner-only authenticated recovery portal</div>
      </section>
      <footer className="auth-footer">Developed by 😈gunakarna😈</footer>
    </main>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const data = await api("/api/devices");
    const items: Device[] = data.items || [];
    setDevices(items);
    if (!selected && items.length) setSelected(items[0].id);
  }

  async function refresh(id = selected) {
    if (!id) return;
    const data = await api(`/api/devices/${id}`);
    setDevice(data.device);
  }

  useEffect(() => {
    api("/api/auth/session")
      .then(() => setLogin(true))
      .catch(() => setLogin(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => { if (login) void load(); }, [login]);
  useEffect(() => { if (login && selected) void refresh(selected); }, [login, selected]);
  useEffect(() => {
    if (!login || !selected) return;
    const timer = window.setInterval(() => {
      void refresh(selected);
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [login, selected]);

  async function action(name: string, args: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(name);
    setMsg("Sending secure recovery request…");
    try {
      const data = await api(`/api/devices/${selected}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: name, args }),
      });
      setMsg(`Recovery request queued securely • ${data.commandId}`);
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        await refresh(selected).catch(() => {});
        await load().catch(() => {});
        if (attempts >= 12) {
          window.clearInterval(timer);
          setBusy(null);
        }
      }, 2500);
    } catch (error) {
      setBusy(null);
      setMsg(error instanceof Error ? error.message : "Action failed");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    setLogin(false);
    setDevices([]);
    setDevice(null);
  }

  async function shareLocation() {
    if (!device?.location) return;
    const url = googleMapsUrl(device.location);
    const text = `${device.deviceName || device.deviceId || "Jazz device"} last known location: ${device.location.latitude}, ${device.location.longitude}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Jazz Lost Mode Location", text, url });
        setMsg("Location shared.");
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setMsg("Location link copied to clipboard.");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") setMsg("Could not share location on this browser.");
    }
  }

  function downloadReport() {
    if (!device) return;
    const report = {
      exportedAt: new Date().toISOString(),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      online: device.online,
      mode: device.mode,
      battery: device.battery,
      charging: device.charging,
      network: device.network,
      lastSeen: device.lastSeen,
      lastKnownLocation: device.location,
      latestRecoveryPhoto: device.photo ? {
        camera: device.photo.camera,
        timestamp: device.photo.timestamp,
        includedSeparately: true,
      } : null,
    };
    downloadText(`jazz-recovery-${device.deviceId || device.id}.json`, JSON.stringify(report, null, 2));
    setMsg("Recovery report downloaded.");
  }

  const onlineCount = useMemo(() => devices.filter((item) => item.online).length, [devices]);

  if (!ready) return <div className="loading-screen"><RefreshCw className="spin" /> Loading secure recovery…</div>;
  if (!login) return <Login done={() => setLogin(true)} />;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar glass-panel">
        <div className="brand-block">
          <div className="brand-mark small-mark"><Sparkles size={20} /></div>
          <div><div className="eyebrow">JAZZ AI ASSISTANT</div><h1>Lost Mode Command Center</h1></div>
        </div>
        <div className="topbar-actions">
          <div className="fleet-pill"><Radio size={16} /><span>{onlineCount}/{devices.length} online</span></div>
          <button className="ghost-button" onClick={() => { void load(); if (selected) void refresh(selected); }}><RefreshCw size={17} /> Refresh</button>
          <button className="ghost-button danger-hover" onClick={logout}><LogOut size={17} /> Logout</button>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="device-sidebar glass-panel">
          <div className="sidebar-title"><div><span className="eyebrow">MY DEVICES</span><h2>Recovery Fleet</h2></div><span className="count-badge">{devices.length}</span></div>
          <div className="device-list">
            {devices.length === 0 && <div className="empty-state compact"><Smartphone size={24} /><span>No enrolled devices</span></div>}
            {devices.map((item) => (
              <button key={item.id} className={`device-row ${selected === item.id ? "selected" : ""}`} onClick={() => setSelected(item.id)}>
                <div className={`device-avatar ${item.online ? "live" : ""}`}><Smartphone size={21} /></div>
                <div className="device-row-copy"><strong>{item.deviceName || item.deviceId || "Device"}</strong><span>{item.deviceId || item.deviceType}</span><small className={item.online ? "online-text" : "offline-text"}>{item.online ? "● Online" : "● Offline"}</small></div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
          <div className="sidebar-security"><ShieldCheck size={18} /><div><strong>Secure recovery</strong><span>Encrypted owner-authorized channel</span></div></div>
        </aside>

        <main className="dashboard-main">
          {!device ? <section className="glass-panel empty-state"><Smartphone size={36} /><h2>Select a device</h2><p>Choose an enrolled device to open recovery controls.</p></section> : <>
            <section className="device-hero glass-panel">
              <div className="hero-main">
                <div className={`status-orb ${device.online ? "live" : "offline-orb"}`}><CircleDot size={25} /></div>
                <div>
                  <div className={`status-label ${device.online ? "online-text" : "offline-text"}`}>{device.online ? "ONLINE • LIVE CONNECTION" : "OFFLINE • LAST KNOWN STATE"}</div>
                  <h2>{device.deviceName || device.deviceId || "Registered device"}</h2>
                  <div className="device-id-line">{device.deviceId || "Registered device"} · {device.deviceType}</div>
                </div>
              </div>
              <div className="mode-badge"><ShieldCheck size={17} /> {device.mode}</div>
              <div className="metrics-grid">
                <div className="metric-card"><BatteryCharging size={20} /><div><span>Battery</span><strong>{device.battery ?? "--"}%</strong></div></div>
                <div className="metric-card"><Wifi size={20} /><div><span>Network</span><strong>{device.network || "Unknown"}</strong></div></div>
                <div className="metric-card"><Gauge size={20} /><div><span>Last Seen</span><strong>{formatTime(device.lastSeen)}</strong></div></div>
              </div>
            </section>

            <section className="section-heading"><div><span className="eyebrow">RECOVERY ACTIONS</span><h2>Remote controls</h2></div><span>Commands use the existing allowlisted recovery workflow.</span></section>
            <section className="action-grid">
              <button onClick={() => action("DEVICE_STATUS")}><Smartphone /><div><strong>Device Status</strong><span>Refresh device health</span></div></button>
              <button onClick={() => action("GET_LOCATION")}><LocateFixed /><div><strong>Get Location</strong><span>Request latest position</span></div></button>
              <button onClick={() => action("RING_DEVICE")}><Volume2 /><div><strong>Ring Device</strong><span>Play recovery alert</span></div></button>
              <button onClick={() => action("RECOVERY_PHOTO", { camera: "front" })}><Camera /><div><strong>Front Camera</strong><span>Request recovery photo</span></div></button>
              <button onClick={() => action("RECOVERY_PHOTO", { camera: "rear" })}><Camera /><div><strong>Back Camera</strong><span>Request recovery photo</span></div></button>
              <button className="critical-action" onClick={() => action("SET_RECOVERY_MODE", { enabled: true })}><ShieldCheck /><div><strong>Enable Lost Mode</strong><span>Secure recovery state</span></div></button>
            </section>

            {(msg || busy) && <div className="command-banner glass-panel"><div className="pulse-dot" /><span>{msg || "Processing…"}</span>{busy && <RefreshCw className="spin" size={16} />}</div>}

            <section className="recovery-grid">
              <article className="location-card glass-panel">
                <div className="card-heading">
                  <div><span className="eyebrow">LAST KNOWN LOCATION</span><h2>Device map</h2></div>
                  <MapPin size={22} />
                </div>
                {device.location ? <>
                  <div className="map-frame">
                    <iframe
                      title="Last known device location"
                      src={mapEmbedUrl(device.location)}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <div className="map-overlay"><Navigation size={15} /> Last known position</div>
                  </div>
                  <div className="location-meta">
                    <div><span>Coordinates</span><strong>{device.location.latitude.toFixed(6)}, {device.location.longitude.toFixed(6)}</strong></div>
                    <div><span>Accuracy</span><strong>{device.location.accuracyMeters ?? "--"} m</strong></div>
                    <div><span>Location time</span><strong>{formatTime(device.location.timestamp)}</strong></div>
                  </div>
                  <div className="card-actions">
                    <a className="primary-button" target="_blank" rel="noreferrer" href={googleMapsUrl(device.location)}><ExternalLink size={17} /> Open in Maps</a>
                    <button className="secondary-button" onClick={shareLocation}><Navigation size={17} /> Share Location</button>
                  </div>
                </> : <div className="empty-state"><Crosshair size={34} /><h3>No location yet</h3><p>Use Get Location to request the latest available position.</p></div>}
              </article>

              <article className="photo-card glass-panel">
                <div className="card-heading">
                  <div><span className="eyebrow">RECOVERY EVIDENCE</span><h2>Latest recovery photo</h2></div>
                  <Camera size={22} />
                </div>
                {device.photo ? <>
                  <div className="photo-frame"><img src={device.photo.dataUrl} alt="Latest recovery capture" /></div>
                  <div className="photo-meta"><span>{device.photo.camera || "camera"} camera</span><span>{formatTime(device.photo.timestamp)}</span></div>
                  <div className="card-actions stacked-mobile">
                    <a className="primary-button" href={device.photo.dataUrl} download={`jazz-recovery-${device.deviceId || device.id}.jpg`}><Download size={17} /> Download Recovery Photo</a>
                    <button className="secondary-button" onClick={downloadReport}><Download size={17} /> Download Recovery Report</button>
                  </div>
                </> : <div className="empty-state photo-empty"><Camera size={34} /><h3>No recovery photo yet</h3><p>Use Front Camera or Back Camera to request a recovery image.</p><button className="secondary-button" onClick={downloadReport}><Download size={17} /> Download Recovery Report</button></div>}
              </article>
            </section>
          </>}
        </main>
      </div>

      <footer className="site-footer"><span>Jazz Lost Mode • Secure Device Recovery</span><span>Developed by 😈gunakarna😈</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
