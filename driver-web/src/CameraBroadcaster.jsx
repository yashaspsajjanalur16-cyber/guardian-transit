import { useEffect, useRef } from "react";

const SIGNALING_SERVER = "ws://localhost:8080";

let driverSocket = null;

export function sendDriverTelemetry(telemetry) {
  if (
    !driverSocket ||
    driverSocket.readyState !== WebSocket.OPEN
  ) {
    console.log("⚠️ Telemetry socket not ready");
    return false;
  }

  driverSocket.send(
    JSON.stringify({
      type: "DRIVER_TELEMETRY",
      ...telemetry,
      timestamp: telemetry.timestamp || Date.now(),
    })
  );

  console.log("📡 Driver telemetry sent:", telemetry);

  return true;
}

function CameraBroadcaster({ stream }) {
  const socketRef = useRef(null);
  const peerRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    let mounted = true;

    const createOffer = async () => {
      try {
        if (!stream) return;

        if (peerRef.current) {
          peerRef.current.close();
          peerRef.current = null;
        }

        const peer = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.l.google.com:19302",
            },
          ],
        });

        peerRef.current = peer;

        stream.getTracks().forEach((track) => {
          peer.addTrack(track, stream);
        });

        peer.onicecandidate = (event) => {
          if (
            event.candidate &&
            socketRef.current?.readyState ===
              WebSocket.OPEN
          ) {
            socketRef.current.send(
              JSON.stringify({
                type: "ICE_CANDIDATE",
                candidate: event.candidate,
                vehicle: "BUS-101",
              })
            );
          }
        };

        peer.onconnectionstatechange = () => {
          console.log(
            "🔗 Driver WebRTC state:",
            peer.connectionState
          );
        };

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        if (
          socketRef.current?.readyState ===
          WebSocket.OPEN
        ) {
          socketRef.current.send(
            JSON.stringify({
              type: "OFFER",
              offer,
              vehicle: "BUS-101",
              driver: "Driver A",
            })
          );

          console.log("📤 WebRTC offer sent");
        }
      } catch (error) {
        console.error(
          "❌ Offer creation error:",
          error
        );
      }
    };

    const connectToServer = () => {
      try {
        console.log(
          "🎥 Starting Driver Camera Broadcaster..."
        );

        const socket = new WebSocket(
          SIGNALING_SERVER
        );

        socketRef.current = socket;
        driverSocket = socket;

        socket.onopen = () => {
          if (!mounted) return;

          console.log(
            "✅ Driver connected to signaling server"
          );

          socket.send(
            JSON.stringify({
              type: "DRIVER_READY",
              vehicle: "BUS-101",
              driver: "Driver A",
            })
          );
        };

        socket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);

            console.log(
              "📨 Driver received:",
              data.type
            );

            // ADMIN READY
            if (data.type === "ADMIN_READY") {
              await createOffer();
              return;
            }

            // WEBRTC ANSWER
            if (data.type === "ANSWER") {
              if (!peerRef.current) {
                return;
              }

              await peerRef.current.setRemoteDescription(
                new RTCSessionDescription(data.answer)
              );

              console.log(
                "✅ WebRTC answer received"
              );

              return;
            }

            // ICE CANDIDATE
            if (
              data.type === "ICE_CANDIDATE" &&
              data.candidate &&
              peerRef.current
            ) {
              try {
                await peerRef.current.addIceCandidate(
                  new RTCIceCandidate(data.candidate)
                );

                console.log(
                  "🧊 ICE candidate added"
                );
              } catch (error) {
                console.error(
                  "ICE candidate error:",
                  error
                );
              }

              return;
            }

            // AUDIO ALERT
            if (data.type === "AUDIO_ALERT") {
              console.log(
                "🔊 AUDIO ALERT received"
              );

              window.dispatchEvent(
                new CustomEvent(
                  "guardianTransitAudioAlert",
                  {
                    detail: data,
                  }
                )
              );

              return;
            }

            // REPLACE VEHICLE
            if (data.type === "REPLACE_VEHICLE") {
              console.log(
                "🚨 REPLACE VEHICLE received"
              );

              window.dispatchEvent(
                new CustomEvent(
                  "guardianTransitReplaceVehicle",
                  {
                    detail: data,
                  }
                )
              );

              return;
            }
          } catch (error) {
            console.error(
              "❌ Signaling message error:",
              error
            );
          }
        };

        socket.onerror = (error) => {
          console.error(
            "❌ Signaling server error:",
            error
          );
        };

        socket.onclose = () => {
          console.log(
            "🔌 Driver disconnected from signaling server"
          );
        };
      } catch (error) {
        console.error(
          "❌ Broadcaster connection error:",
          error
        );
      }
    };

    connectToServer();

    return () => {
      mounted = false;

      const currentSocket = socketRef.current;

      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }

      if (currentSocket) {
        currentSocket.close();
      }

      if (driverSocket === currentSocket) {
        driverSocket = null;
      }

      socketRef.current = null;
    };
  }, [stream]);

  return null;
}

export default CameraBroadcaster;