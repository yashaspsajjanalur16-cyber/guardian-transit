import { useEffect, useRef, useState } from "react";

import "./App.css";

import FaceMonitor from "./FaceMonitor";

import CameraBroadcaster, {
  sendDriverTelemetry,
} from "./CameraBroadcaster";

function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const [riskScore, setRiskScore] = useState(12);
  const [eyeStatus, setEyeStatus] = useState("NORMAL");
  const [fatigue, setFatigue] = useState("LOW");
  const [attention, setAttention] = useState("FOCUSED");
  const [yawns, setYawns] = useState(0);

  // ==========================================
  // CAMERA STREAM
  // ==========================================

  const [cameraStream, setCameraStream] =
    useState(null);

  // ==========================================
  // PRE-TRIP SOBRIETY
  // ==========================================

  const [sobrietyStatus, setSobrietyStatus] =
    useState("NOT CHECKED");

  const [sobrietyRunning, setSobrietyRunning] =
    useState(false);

  const [tripStarted, setTripStarted] =
    useState(false);

  const [sobrietyMessage, setSobrietyMessage] =
    useState(
      "Complete the pre-trip sobriety check before starting the trip."
    );

  // ==========================================
  // CRITICAL ALERT
  // ==========================================

  const [criticalAlert, setCriticalAlert] =
    useState(false);

  // ==========================================
  // START CAMERA
  // ==========================================

  const startCamera = async () => {
    try {
      setCameraError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Camera access is not supported by this browser."
        );

        return;
      }

      console.log("📷 Requesting camera access...");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            width: {
              ideal: 1280,
            },

            height: {
              ideal: 720,
            },

            facingMode: "user",
          },

          audio: false,
        });

      console.log("✅ Camera stream received");

      streamRef.current = stream;

      setCameraStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        await videoRef.current.play();

        console.log(
          "✅ Video started:",
          videoRef.current.videoWidth,
          "x",
          videoRef.current.videoHeight
        );
      }

      setCameraActive(true);

      console.log("📷 CAMERA ACTIVE");
    } catch (error) {
      console.error(
        "❌ Camera error:",
        error
      );

      setCameraError(
        "Unable to access camera. Please allow camera permission."
      );

      setCameraActive(false);
      setCameraStream(null);
    }
  };

  // ==========================================
  // STOP CAMERA
  // ==========================================

  const stopCamera = () => {
    console.log("⏹ Stopping camera...");

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStream(null);

    setCameraActive(false);

    console.log("📷 CAMERA OFF");
  };

  // ==========================================
  // PRE-TRIP SOBRIETY CHECK
  // ==========================================

  const runSobrietyCheck = () => {
    if (sobrietyRunning) {
      return;
    }

    setSobrietyRunning(true);

    setSobrietyStatus("CHECKING");

    setTripStarted(false);

    setSobrietyMessage(
      "Performing pre-trip sobriety verification..."
    );

    // Demo verification sequence
    setTimeout(() => {
      setSobrietyStatus("CHECKING");

      setSobrietyMessage(
        "Checking driver readiness and response..."
      );
    }, 1200);

    setTimeout(() => {
      setSobrietyStatus("PASS");

      setSobrietyRunning(false);

      setSobrietyMessage(
        "Sobriety verification passed. Driver is cleared for trip."
      );

      sendDriverTelemetry({
        status: "SOBRIETY CHECK PASSED",

        risk: 5,

        vehicle: "BUS-101",

        driver: "Driver A",

        eyeStatus: "NORMAL",

        headStatus: "FOCUSED",

        yawns,

        sobriety: "PASS",

        timestamp: Date.now(),
      });
    }, 2800);
  };

  // ==========================================
  // START TRIP
  // ==========================================

  const startTrip = () => {
    if (sobrietyStatus !== "PASS") {
      setSobrietyMessage(
        "Trip cannot start until sobriety verification is passed."
      );

      return;
    }

    setTripStarted(true);

    sendDriverTelemetry({
      status: "TRIP STARTED",

      risk: riskScore,

      vehicle: "BUS-101",

      driver: "Driver A",

      eyeStatus,

      headStatus: attention,

      yawns,

      sobriety: "PASS",

      timestamp: Date.now(),
    });
  };

  // ==========================================
  // AI STATUS
  // ==========================================

  const handleAIStatus = (status) => {
    console.log(
      "🤖 AI STATUS:",
      status
    );

    let newRisk = 15;

    // ========================================
    // RISK
    // ========================================

    if (
      status ===
      "MICRO-SLEEP DETECTED"
    ) {
      newRisk = 92;
    } else if (
      status === "EYES CLOSED"
    ) {
      newRisk = 55;
    } else if (
      status === "YAWN DETECTED"
    ) {
      newRisk = 65;
    } else if (
      status === "FACE NOT DETECTED"
    ) {
      newRisk = 35;
    } else if (
      status === "DRIVER FOCUSED"
    ) {
      newRisk = 12;
    }

    setRiskScore(newRisk);

    // ========================================
    // EYES / FATIGUE
    // ========================================

    if (
      status === "MICRO-SLEEP DETECTED" ||
      status === "EYES CLOSED"
    ) {
      setEyeStatus("CLOSED");

      setFatigue(
        status ===
          "MICRO-SLEEP DETECTED"
          ? "HIGH"
          : "MEDIUM"
      );
    } else {
      setEyeStatus("NORMAL");

      if (
        status === "YAWN DETECTED"
      ) {
        setFatigue("MEDIUM");
      } else {
        setFatigue("LOW");
      }
    }

    // ========================================
    // ATTENTION
    // ========================================

    if (
      status === "FACE NOT DETECTED"
    ) {
      setAttention(
        "NOT DETECTED"
      );
    } else {
      setAttention("FOCUSED");
    }

    // ========================================
    // YAWNS
    // ========================================

    let currentYawns = yawns;

    if (
      status === "YAWN DETECTED"
    ) {
      currentYawns = yawns + 1;

      setYawns(
        currentYawns
      );
    }

    // ========================================
    // CRITICAL ALERT
    // ========================================

    if (
      status ===
      "MICRO-SLEEP DETECTED"
    ) {
      triggerCriticalAlert();
    }

    // ========================================
    // LIVE TELEMETRY
    // ========================================

    sendDriverTelemetry({
      status,

      risk: newRisk,

      vehicle: "BUS-101",

      driver: "Driver A",

      eyeStatus:
        status === "EYES CLOSED" ||
        status ===
          "MICRO-SLEEP DETECTED"
          ? "CLOSED"
          : "NORMAL",

      headStatus:
        status ===
        "FACE NOT DETECTED"
          ? "NOT DETECTED"
          : "FOCUSED",

      yawns: currentYawns,

      sobriety:
        sobrietyStatus,

      timestamp: Date.now(),
    });

    // ========================================
    // LOCAL STORAGE STATUS
    // ========================================

    localStorage.setItem(
      "guardianTransitDriverStatus",
      JSON.stringify({
        status,

        risk: newRisk,

        vehicle: "BUS-101",

        driver: "Driver A",

        eyeStatus:
          status === "EYES CLOSED" ||
          status ===
            "MICRO-SLEEP DETECTED"
            ? "CLOSED"
            : "NORMAL",

        headStatus:
          status ===
          "FACE NOT DETECTED"
            ? "NOT DETECTED"
            : "FOCUSED",

        yawns: currentYawns,

        sobriety:
          sobrietyStatus,

        timestamp: Date.now(),
      })
    );

    // ========================================
    // INCIDENT LOGGING
    // ========================================

    if (
      status ===
        "MICRO-SLEEP DETECTED" ||
      status === "EYES CLOSED" ||
      status === "YAWN DETECTED"
    ) {
      localStorage.setItem(
        "guardianTransitIncident",
        JSON.stringify({
          event: status,

          vehicle: "BUS-101",

          driver: "Driver A",

          severity:
            status ===
            "MICRO-SLEEP DETECTED"
              ? "critical"
              : "warning",

          timestamp: Date.now(),
        })
      );
    }
  };

  // ==========================================
  // CRITICAL ALERT
  // ==========================================

  const triggerCriticalAlert = () => {
    setCriticalAlert(true);

    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (AudioContext) {
        const audioContext =
          new AudioContext();

        const oscillator =
          audioContext.createOscillator();

        const gainNode =
          audioContext.createGain();

        oscillator.type =
          "square";

        oscillator.frequency.setValueAtTime(
          880,
          audioContext.currentTime
        );

        gainNode.gain.setValueAtTime(
          0.15,
          audioContext.currentTime
        );

        oscillator.connect(
          gainNode
        );

        gainNode.connect(
          audioContext.destination
        );

        oscillator.start();

        setTimeout(() => {
          oscillator.stop();

          audioContext.close();
        }, 700);
      }
    } catch (error) {
      console.log(
        "Audio alert unavailable:",
        error
      );
    }

    setTimeout(() => {
      setCriticalAlert(false);
    }, 5000);
  };

  // ==========================================
  // TEST CRITICAL ALERT
  // ==========================================

  const testCriticalAlert = () => {
    triggerCriticalAlert();

    setRiskScore(92);

    setFatigue("HIGH");

    setEyeStatus("CLOSED");

    handleAIStatus(
      "MICRO-SLEEP DETECTED"
    );
  };

  // ==========================================
  // RESET
  // ==========================================

  const resetDemo = () => {
    setRiskScore(12);

    setEyeStatus("NORMAL");

    setFatigue("LOW");

    setAttention("FOCUSED");

    setYawns(0);

    setCriticalAlert(false);

    sendDriverTelemetry({
      status: "DRIVER FOCUSED",

      risk: 12,

      vehicle: "BUS-101",

      driver: "Driver A",

      eyeStatus: "NORMAL",

      headStatus: "FOCUSED",

      yawns: 0,

      sobriety:
        sobrietyStatus,

      timestamp: Date.now(),
    });
  };

  // ==========================================
  // CLEANUP
  // ==========================================

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current
          .getTracks()
          .forEach((track) => {
            track.stop();
          });
      }
    };
  }, []);

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="app">

      {/* =====================================
          CRITICAL ALERT
      ====================================== */}

      {criticalAlert && (
        <div className="critical-alert">
          🚨 CRITICAL DRIVER FATIGUE ALERT

          <span>
            Micro-sleep detected — immediate
            driver intervention required
          </span>
        </div>
      )}

      {/* =====================================
          HEADER
      ====================================== */}

      <header className="app-header">

        <div>
          <h1>
            GUARDIANTRANSIT
          </h1>

          <p>
            Driver Companion
          </p>
        </div>

        <div className="system-status">
          <span className="status-dot" />

          SYSTEM ONLINE
        </div>

      </header>

      <main className="dashboard">

        {/* ===================================
            SOBRIETY
        ==================================== */}

        <section className="card sobriety-card">

          <div className="card-header">

            <div>
              <h2>
                🧪 Pre-Trip Sobriety Verification
              </h2>

              <p>
                Complete verification before
                starting the vehicle.
              </p>
            </div>

            <div
              className={`sobriety-badge ${sobrietyStatus
                .toLowerCase()
                .replace(" ", "-")}`}
            >
              {sobrietyStatus}
            </div>

          </div>

          <div className="sobriety-content">

            <div className="sobriety-icon">
              {sobrietyStatus ===
              "PASS"
                ? "✅"
                : sobrietyStatus ===
                  "CHECKING"
                ? "🔄"
                : "🧪"}
            </div>

            <div className="sobriety-info">

              <h3>
                {sobrietyStatus ===
                "PASS"
                  ? "Driver Cleared"
                  : sobrietyStatus ===
                    "CHECKING"
                  ? "Verification in Progress"
                  : "Verification Required"}
              </h3>

              <p>
                {sobrietyMessage}
              </p>

            </div>

            <div className="sobriety-actions">

              <button
                className="primary-button"
                onClick={
                  runSobrietyCheck
                }
                disabled={
                  sobrietyRunning
                }
              >
                {sobrietyRunning
                  ? "Checking..."
                  : "Run Sobriety Check"}
              </button>

              <button
                className="secondary-button"
                onClick={startTrip}
                disabled={
                  sobrietyStatus !==
                    "PASS" ||
                  tripStarted
                }
              >
                {tripStarted
                  ? "🚌 Trip Active"
                  : "▶ Start Trip"}
              </button>

            </div>

          </div>

        </section>

        {/* ===================================
            STATUS CARDS
        ==================================== */}

        <section className="stats-grid">

          <div className="stat-card">
            <span>
              RISK SCORE
            </span>

            <strong
              className={
                riskScore >= 80
                  ? "danger"
                  : riskScore >= 50
                  ? "warning"
                  : "safe"
              }
            >
              {riskScore}
            </strong>

            <small>
              / 100
            </small>
          </div>

          <div className="stat-card">
            <span>
              FATIGUE
            </span>

            <strong>
              {fatigue}
            </strong>
          </div>

          <div className="stat-card">
            <span>
              EYE STATUS
            </span>

            <strong>
              {eyeStatus}
            </strong>
          </div>

          <div className="stat-card">
            <span>
              ATTENTION
            </span>

            <strong>
              {attention}
            </strong>
          </div>

          <div className="stat-card">
            <span>
              YAWNS
            </span>

            <strong>
              {yawns}
            </strong>
          </div>

          <div className="stat-card">
            <span>
              TRIP STATUS
            </span>

            <strong>
              {tripStarted
                ? "ACTIVE"
                : "NOT STARTED"}
            </strong>
          </div>

        </section>

        {/* ===================================
            CAMERA
        ==================================== */}

        <section className="card">

          <div className="card-header">

            <div>
              <h2>
                📹 Driver Monitoring Camera
              </h2>

              <p>
                Real-time fatigue and attention
                monitoring
              </p>
            </div>

            <div className="camera-status">

              <span
                className={
                  cameraActive
                    ? "status-dot active"
                    : "status-dot"
                }
              />

              {cameraActive
                ? "CAMERA ACTIVE"
                : "CAMERA OFF"}

            </div>

          </div>

          <div className="camera-container">

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="driver-video"
            />

            {!cameraActive && (
              <div className="camera-placeholder">

                <div>
                  📷
                </div>

                <p>
                  Camera is not active
                </p>

              </div>
            )}

          </div>

          {cameraError && (
            <div className="camera-error">
              ⚠️ {cameraError}
            </div>
          )}

          <div className="camera-actions">

            {!cameraActive ? (
              <button
                className="primary-button"
                onClick={
                  startCamera
                }
              >
                📷 Start Camera
              </button>
            ) : (
              <button
                className="danger-button"
                onClick={
                  stopCamera
                }
              >
                ⏹ Stop Camera
              </button>
            )}

            <button
              className="secondary-button"
              onClick={
                resetDemo
              }
            >
              🔄 Reset Monitoring
            </button>

            <button
              className="critical-button"
              onClick={
                testCriticalAlert
              }
            >
              🚨 Test Critical Alert
            </button>

          </div>

        </section>

        {/* ===================================
            AI MONITOR
        ==================================== */}

        {cameraActive && (
          <FaceMonitor
            videoRef={videoRef}
            cameraActive={cameraActive}
            onStatusChange={
              handleAIStatus
            }
          />
        )}

        {/* ===================================
            CAMERA BROADCAST
        ==================================== */}

        <CameraBroadcaster
          stream={cameraStream}
        />

        {/* ===================================
            DRIVER INFORMATION
        ==================================== */}

        <section className="card">

          <div className="card-header">

            <div>
              <h2>
                👤 Driver Information
              </h2>

              <p>
                Current assigned vehicle
              </p>
            </div>

          </div>

          <div className="driver-info-grid">

            <div>
              <span>
                Driver
              </span>

              <strong>
                Driver A
              </strong>
            </div>

            <div>
              <span>
                Vehicle
              </span>

              <strong>
                BUS-101
              </strong>
            </div>

            <div>
              <span>
                Route
              </span>

              <strong>
                401
              </strong>
            </div>

            <div>
              <span>
                Location
              </span>

              <strong>
                Yelahanka
              </strong>
            </div>

            <div>
              <span>
                Sobriety
              </span>

              <strong
                className={
                  sobrietyStatus ===
                  "PASS"
                    ? "safe"
                    : "warning"
                }
              >
                {sobrietyStatus}
              </strong>
            </div>

            <div>
              <span>
                Trip
              </span>

              <strong>
                {tripStarted
                  ? "ACTIVE"
                  : "READY"}
              </strong>
            </div>

          </div>

        </section>

      </main>

      {/* =====================================
          FOOTER
      ====================================== */}

      <footer className="app-footer">

        <span>
          GuardianTransit AI Safety System
        </span>

        <span>
          BUS-101 • Driver A
        </span>

      </footer>

    </div>
  );
}

export default App;