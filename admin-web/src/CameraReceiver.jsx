import { useEffect, useRef, useState } from "react";

const SIGNALING_SERVER = "wss://guardian-transit.onrender.com";

function CameraReceiver() {
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const peerRef = useRef(null);

  const pendingCandidatesRef = useRef([]);

  const [status, setStatus] =
    useState("WAITING FOR DRIVER");

  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const socket = new WebSocket(
      SIGNALING_SERVER
    );

    socketRef.current = socket;

    socket.onopen = () => {
      console.log(
        "✅ Admin connected to signaling server"
      );

      setStatus("WAITING FOR DRIVER");
      setError("");

      // Tell server Admin is ready
      socket.send(
        JSON.stringify({
          type: "ADMIN_READY",
        })
      );
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        console.log(
          "📨 Admin received:",
          data.type
        );

        // =========================
        // DRIVER AVAILABLE
        // =========================

        if (data.type === "DRIVER_AVAILABLE") {
          setStatus("CONNECTING TO DRIVER");

          console.log(
            "🚍 Driver available:",
            data.vehicle,
            data.driver
          );

          return;
        }

        // =========================
        // DRIVER OFFER
        // =========================

        if (data.type === "OFFER") {
          console.log(
            "📥 WebRTC offer received"
          );

          setStatus("CONNECTING TO DRIVER");

          // Close old connection
          if (peerRef.current) {
            peerRef.current.close();
            peerRef.current = null;
          }

          pendingCandidatesRef.current = [];

          const peer =
            new RTCPeerConnection({
              iceServers: [
                {
                  urls:
                    "stun:stun.l.google.com:19302",
                },
              ],
            });

          peerRef.current = peer;

          // =========================
          // RECEIVE DRIVER CAMERA
          // =========================

          peer.ontrack = (event) => {
            console.log(
              "🎥 DRIVER CAMERA STREAM RECEIVED"
            );

            if (
              videoRef.current &&
              event.streams &&
              event.streams[0]
            ) {
              videoRef.current.srcObject =
                event.streams[0];

              videoRef.current
                .play()
                .catch((error) => {
                  console.warn(
                    "Video autoplay:",
                    error
                  );
                });

              setStatus("LIVE DRIVER FEED");
              setError("");
            }
          };

          // =========================
          // ICE
          // =========================

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
                })
              );

              console.log(
                "🧊 Admin sent ICE candidate"
              );
            }
          };

          peer.onconnectionstatechange = () => {
            console.log(
              "🔗 Admin WebRTC state:",
              peer.connectionState
            );

            if (
              peer.connectionState ===
              "connected"
            ) {
              setStatus("LIVE DRIVER FEED");
              setError("");
            }

            if (
              peer.connectionState ===
                "failed" ||
              peer.connectionState ===
                "disconnected"
            ) {
              setStatus("DISCONNECTED");
              setError(
                "WebRTC connection lost."
              );
            }
          };

          peer.oniceconnectionstatechange =
            () => {
              console.log(
                "🧊 Admin ICE state:",
                peer.iceConnectionState
              );
            };

          // =========================
          // SET OFFER
          // =========================

          await peer.setRemoteDescription(
            new RTCSessionDescription(data.offer)
          );

          console.log(
            "✅ Remote offer set"
          );

          // =========================
          // CREATE ANSWER
          // =========================

          const answer =
            await peer.createAnswer();

          await peer.setLocalDescription(
            answer
          );

          socket.send(
            JSON.stringify({
              type: "ANSWER",
              answer: peer.localDescription,
            })
          );

          console.log(
            "📤 WebRTC answer sent"
          );

          // =========================
          // ADD QUEUED ICE
          // =========================

          for (const candidate of pendingCandidatesRef.current) {
            try {
              await peer.addIceCandidate(
                candidate
              );
            } catch (error) {
              console.error(
                "Queued ICE error:",
                error
              );
            }
          }

          pendingCandidatesRef.current = [];

          return;
        }

        // =========================
        // ICE FROM DRIVER
        // =========================

        if (data.type === "ICE_CANDIDATE") {
          if (!data.candidate) {
            return;
          }

          const candidate =
            new RTCIceCandidate(
              data.candidate
            );

          if (
            peerRef.current?.remoteDescription
          ) {
            try {
              await peerRef.current.addIceCandidate(
                candidate
              );

              console.log(
                "🧊 Driver ICE candidate added"
              );
            } catch (error) {
              console.error(
                "ICE error:",
                error
              );
            }
          } else {
            pendingCandidatesRef.current.push(
              candidate
            );

            console.log(
              "⏳ Driver ICE candidate queued"
            );
          }

          return;
        }

        // =========================
        // DRIVER DISCONNECTED
        // =========================

        if (
          data.type ===
          "DRIVER_DISCONNECTED"
        ) {
          setStatus("DRIVER DISCONNECTED");

          if (videoRef.current) {
            videoRef.current.srcObject =
              null;
          }

          return;
        }
      } catch (error) {
        console.error(
          "❌ Admin signaling error:",
          error
        );

        setError(
          "Signaling message error."
        );
      }
    };

    socket.onerror = (error) => {
      console.error(
        "❌ Admin WebSocket error:",
        error
      );

      if (mounted) {
        setStatus("DISCONNECTED");
        setError(
          "Could not connect to signaling server."
        );
      }
    };

    socket.onclose = () => {
      console.log(
        "🔌 Admin disconnected from signaling server"
      );

      if (mounted) {
        setStatus("DISCONNECTED");
      }
    };

    return () => {
      mounted = false;

      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: "300px",
        position: "relative",
        background: "#101827",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          minHeight: "300px",
          objectFit: "cover",
          display: "block",
          background: "#101827",
        }}
      />

      {status !== "LIVE DRIVER FEED" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            color: "#ffffff",
            textAlign: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              fontSize: "36px",
              marginBottom: "12px",
            }}
          >
            📹
          </div>

          <strong>{status}</strong>

          {error && (
            <span
              style={{
                marginTop: "10px",
                color: "#fbbf24",
                fontSize: "13px",
              }}
            >
              {error}
            </span>
          )}
        </div>
      )}

      {status === "LIVE DRIVER FEED" && (
        <div
          style={{
            position: "absolute",
            top: "14px",
            left: "14px",
            background: "#e52525",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "7px",
            fontWeight: "800",
            fontSize: "13px",
          }}
        >
          ● LIVE DRIVER FEED
        </div>
      )}
    </div>
  );
}

export default CameraReceiver;