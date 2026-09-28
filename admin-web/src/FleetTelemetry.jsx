import { useEffect, useRef } from "react";

const SIGNALING_SERVER = "ws://localhost:8080";

function FleetTelemetry({ onTelemetry }) {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const onTelemetryRef = useRef(onTelemetry);

  // Keep latest callback without reconnecting WebSocket
  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) {
        return;
      }

      const existingSocket = socketRef.current;

      if (
        existingSocket &&
        (
          existingSocket.readyState === WebSocket.OPEN ||
          existingSocket.readyState === WebSocket.CONNECTING
        )
      ) {
        return;
      }

      console.log("📡 Connecting Fleet Telemetry...");

      const socket = new WebSocket(SIGNALING_SERVER);

      socketRef.current = socket;

      // ==========================================
      // CONNECTED
      // ==========================================

      socket.onopen = () => {
        console.log("=================================");
        console.log("✅ FLEET TELEMETRY CONNECTED");
        console.log("=================================");

        const adminReady = {
          type: "ADMIN_READY",
          vehicle: "BUS-101",
        };

        socket.send(JSON.stringify(adminReady));

        console.log(
          "📤 ADMIN_READY sent:",
          adminReady
        );
      };

      // ==========================================
      // MESSAGE
      // ==========================================

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          console.log(
            "📥 ADMIN RECEIVED:",
            data
          );

          // ======================================
          // DRIVER TELEMETRY
          // ======================================

          if (data.type === "DRIVER_TELEMETRY") {
            console.log("=================================");
            console.log("🚨 DRIVER TELEMETRY RECEIVED");
            console.log("=================================");
            console.log("Vehicle:", data.vehicle);
            console.log("Driver:", data.driver);
            console.log("Status:", data.status);
            console.log("Risk:", data.risk);
            console.log("Eyes:", data.eyeStatus);
            console.log("Head:", data.headStatus);
            console.log("Yawns:", data.yawns);
            console.log("=================================");

            const telemetry = {
              vehicle:
                data.vehicle ||
                "BUS-101",

              driver:
                data.driver ||
                "Driver A",

              status:
                data.status ||
                "DRIVER FOCUSED",

              risk: Number(
                data.risk ?? 15
              ),

              eyeStatus:
                data.eyeStatus ||
                "NORMAL",

              headStatus:
                data.headStatus ||
                "FOCUSED",

              yawns: Number(
                data.yawns ?? 0
              ),

              timestamp:
                data.timestamp ||
                Date.now(),
            };

            console.log(
              "📊 NORMALIZED TELEMETRY:",
              telemetry
            );

            // Send telemetry to FleetDashboard
            if (
              typeof onTelemetryRef.current ===
              "function"
            ) {
              onTelemetryRef.current(
                telemetry
              );

              console.log(
                "✅ SENT TELEMETRY TO FLEET DASHBOARD:",
                telemetry
              );
            } else {
              console.error(
                "❌ onTelemetry callback is not available"
              );
            }

            return;
          }

          // ======================================
          // DRIVER READY
          // ======================================

          if (data.type === "DRIVER_READY") {
            console.log(
              "🚍 Driver connected:",
              data.vehicle,
              data.driver
            );

            return;
          }

          // ======================================
          // ADMIN READY
          // ======================================

          if (data.type === "ADMIN_READY") {
            console.log(
              "🟢 Admin ready confirmation"
            );

            return;
          }

          // ======================================
          // DRIVER EVIDENCE
          // ======================================

          if (
            data.type ===
            "DRIVER_EVIDENCE_CAPTURED"
          ) {
            console.log(
              "📸 DRIVER EVIDENCE RECEIVED:",
              data
            );

            window.dispatchEvent(
              new CustomEvent(
                "DRIVER_EVIDENCE_CAPTURED",
                {
                  detail: data,
                }
              )
            );

            return;
          }

          // ======================================
          // OTHER MESSAGES
          // ======================================

          console.log(
            "ℹ️ Fleet message:",
            data.type
          );
        } catch (error) {
          console.error(
            "❌ FleetTelemetry message parse error:",
            error
          );
        }
      };

      // ==========================================
      // ERROR
      // ==========================================

      socket.onerror = (error) => {
        console.error(
          "❌ FleetTelemetry WebSocket error:",
          error
        );
      };

      // ==========================================
      // CLOSED
      // ==========================================

      socket.onclose = (event) => {
        console.log(
          "🔌 FleetTelemetry disconnected"
        );

        console.log(
          "WebSocket close code:",
          event.code
        );

        if (
          socketRef.current === socket
        ) {
          socketRef.current = null;
        }

        if (!mountedRef.current) {
          return;
        }

        if (reconnectTimerRef.current) {
          return;
        }

        reconnectTimerRef.current =
          window.setTimeout(() => {
            reconnectTimerRef.current =
              null;

            console.log(
              "🔄 Reconnecting FleetTelemetry..."
            );

            connect();
          }, 2000);
      };
    };

    connect();

    // ==========================================
    // CLEANUP
    // ==========================================

    return () => {
      mountedRef.current = false;

      if (reconnectTimerRef.current) {
        window.clearTimeout(
          reconnectTimerRef.current
        );

        reconnectTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close();

        socketRef.current = null;
      }
    };
  }, []);

  return null;
}

export default FleetTelemetry;
