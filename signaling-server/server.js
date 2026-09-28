import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";

const wss = new WebSocketServer({
  port: PORT,
  host: HOST,
});

const clients = new Set();

console.log("=================================");
console.log("GuardianTransit Signaling Server");
console.log(`WebSocket server running on port ${PORT}`);
console.log("=================================");

wss.on("connection", (socket) => {
  clients.add(socket);

  socket.role = null;
  socket.vehicle = null;
  socket.driver = null;

  console.log("Client connected");

  socket.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      const type = String(data.type || "")
        .trim()
        .toUpperCase()
        .replace(/-/g, "_");

      console.log("📩 Message received:", data.type);

      // =========================
      // DRIVER READY
      // =========================

      if (type === "DRIVER_READY") {
        socket.role = "driver";
        socket.vehicle = data.vehicle || "BUS-101";
        socket.driver = data.driver || "Driver A";

        console.log(
          `🚍 Driver ready: ${socket.vehicle} / ${socket.driver}`
        );

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "admin"
          ) {
            client.send(
              JSON.stringify({
                type: "DRIVER_READY",
                vehicle: socket.vehicle,
                driver: socket.driver,
              })
            );
          }
        });

        return;
      }

      // =========================
      // ADMIN READY
      // =========================

      if (type === "ADMIN_READY") {
        socket.role = "admin";
        socket.vehicle = data.vehicle || null;

        console.log(
          `🖥️ Admin ready${
            socket.vehicle
              ? ` for ${socket.vehicle}`
              : " for ALL VEHICLES"
          }`
        );

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "driver" &&
            (!socket.vehicle || client.vehicle === socket.vehicle)
          ) {
            client.send(
              JSON.stringify({
                type: "ADMIN_READY",
                vehicle: client.vehicle,
              })
            );
          }
        });

        return;
      }

      // =========================
      // DRIVER TELEMETRY
      // =========================

      if (type === "DRIVER_TELEMETRY") {
        const source = data.telemetry || data.data || data;

        const telemetry = {
          type: "DRIVER_TELEMETRY",

          vehicle:
            source.vehicle ||
            socket.vehicle ||
            "BUS-101",

          driver:
            source.driver ||
            socket.driver ||
            "Driver A",

          status:
            source.status ||
            "DRIVER FOCUSED",

          risk: Number(
            source.risk ?? 15
          ),

          eyeStatus:
            source.eyeStatus ||
            "NORMAL",

          headStatus:
            source.headStatus ||
            "FOCUSED",

          yawns: Number(
            source.yawns ?? 0
          ),

          fatigue:
            source.fatigue ||
            "LOW",

          attention:
            source.attention ||
            "FOCUSED",

          timestamp:
            source.timestamp ||
            Date.now(),
        };

        console.log("");
        console.log("=================================");
        console.log("📡 DRIVER TELEMETRY RECEIVED");
        console.log("=================================");
        console.log("Vehicle:", telemetry.vehicle);
        console.log("Driver:", telemetry.driver);
        console.log("Status:", telemetry.status);
        console.log("Risk:", telemetry.risk);
        console.log("Eyes:", telemetry.eyeStatus);
        console.log("Head:", telemetry.headStatus);
        console.log("Yawns:", telemetry.yawns);
        console.log("=================================");

        let adminCount = 0;

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "admin"
          ) {
            client.send(
              JSON.stringify(telemetry)
            );

            adminCount += 1;
          }
        });

        console.log(
          `📤 Telemetry forwarded to ${adminCount} admin connection(s)`
        );

        return;
      }

      // =========================
      // AUDIO ALERT
      // =========================

      if (type === "AUDIO_ALERT") {
        console.log(
          `🔊 Audio alert for ${data.vehicle}`
        );

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "driver" &&
            client.vehicle === data.vehicle
          ) {
            client.send(
              JSON.stringify({
                type: "AUDIO_ALERT",
                vehicle: data.vehicle,
              })
            );
          }
        });

        return;
      }

      // =========================
      // REPLACE VEHICLE
      // =========================

      if (type === "REPLACE_VEHICLE") {
        console.log(
          `🚨 Replacement requested for ${data.vehicle}`
        );

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "driver" &&
            client.vehicle === data.vehicle
          ) {
            client.send(
              JSON.stringify({
                type: "REPLACE_VEHICLE",
                vehicle: data.vehicle,
              })
            );
          }
        });

        return;
      }

      // =========================
      // WEBRTC OFFER
      // =========================

      if (type === "OFFER") {
        const vehicle =
          data.vehicle ||
          socket.vehicle;

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "admin" &&
            (!client.vehicle ||
              client.vehicle === vehicle)
          ) {
            client.send(
              JSON.stringify({
                type: "OFFER",
                offer: data.offer,
                vehicle,
                driver:
                  data.driver ||
                  socket.driver ||
                  "Driver A",
              })
            );
          }
        });

        console.log(
          `📤 OFFER forwarded for ${vehicle}`
        );

        return;
      }

      // =========================
      // WEBRTC ANSWER
      // =========================

      if (type === "ANSWER") {
        const vehicle =
          data.vehicle ||
          socket.vehicle;

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            client.role === "driver" &&
            client.vehicle === vehicle
          ) {
            client.send(
              JSON.stringify({
                type: "ANSWER",
                answer: data.answer,
                vehicle,
              })
            );
          }
        });

        console.log(
          `📤 ANSWER forwarded for ${vehicle}`
        );

        return;
      }

      // =========================
      // ICE CANDIDATE
      // =========================

      if (type === "ICE_CANDIDATE") {
        const vehicle =
          data.vehicle ||
          socket.vehicle;

        clients.forEach((client) => {
          if (
            client !== socket &&
            client.readyState === WebSocket.OPEN &&
            (client.role === "driver" ||
              client.role === "admin") &&
            (!client.vehicle ||
              client.vehicle === vehicle)
          ) {
            client.send(
              JSON.stringify({
                type: "ICE_CANDIDATE",
                candidate: data.candidate,
                vehicle,
              })
            );
          }
        });

        return;
      }

      // =========================
      // UNKNOWN MESSAGE
      // =========================

      console.log(
        "⚠️ Unknown message type:",
        data.type
      );

    } catch (error) {
      console.error(
        "❌ Message processing error:",
        error
      );
    }
  });

  // =========================
  // CLOSE
  // =========================

  socket.on("close", () => {
    clients.delete(socket);

    console.log(
      "🔌 Client disconnected"
    );
  });

  // =========================
  // ERROR
  // =========================

  socket.on("error", (error) => {
    console.error(
      "❌ WebSocket client error:",
      error
    );
  });
});

// =========================
// SERVER ERROR
// =========================

wss.on("error", (error) => {
  console.error(
    "❌ WebSocket server error:",
    error
  );
});