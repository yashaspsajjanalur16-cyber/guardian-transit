import { useEffect, useRef, useState } from "react";

const SIGNALING_SERVER = "ws://localhost:8080";

let adminSocket = null;

// =====================================================
// SEND COMMAND TO DRIVER
// =====================================================

export function sendDriverCommand(command, vehicle) {
  if (
    !adminSocket ||
    adminSocket.readyState !== WebSocket.OPEN
  ) {
    console.error(
      "❌ Admin WebSocket is not connected"
    );
    return false;
  }

  adminSocket.send(
    JSON.stringify({
      type: command,
      vehicle: vehicle || "BUS-101",
      time: Date.now(),
    })
  );

  console.log(
    `📤 ${command} sent to ${vehicle || "BUS-101"}`
  );

  return true;
}

// =====================================================
// REMOTE DRIVER CAMERA
// =====================================================

function RemoteDriverCamera({
  vehicleId = "BUS-101",
}) {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const socketRef = useRef(null);

  const [status, setStatus] =
    useState("CONNECTING");

  const [captureStatus, setCaptureStatus] =
    useState("");

  // =====================================================
  // CAPTURE DRIVER CAMERA EVIDENCE
  // =====================================================

  const captureEvidence = () => {
    const video = videoRef.current;

    if (!video) {
      console.error(
        "❌ Driver video element not available"
      );

      setCaptureStatus(
        "Camera video unavailable"
      );

      return;
    }

    if (
      !video.videoWidth ||
      !video.videoHeight
    ) {
      console.error(
        "❌ Driver video is not ready"
      );

      setCaptureStatus(
        "Waiting for driver camera..."
      );

      // WebRTC video metadata can become available shortly after
      // the connection reports LIVE. Retry briefly before declaring
      // evidence capture unavailable.
      let attempts = 0;
      const retryCapture = () => {
        attempts += 1;

        const currentVideo = videoRef.current;

        if (
          currentVideo &&
          currentVideo.videoWidth &&
          currentVideo.videoHeight
        ) {
          captureEvidence();
          return;
        }

        if (attempts < 6) {
          window.setTimeout(retryCapture, 500);
          return;
        }

        setCaptureStatus(
          "Driver camera is not ready"
        );

        window.dispatchEvent(
          new CustomEvent(
            "DRIVER_EVIDENCE_CAPTURE_FAILED",
            {
              detail: {
                vehicle: vehicleId,
                reason: "VIDEO_NOT_READY",
              },
            }
          )
        );
      };

      window.setTimeout(retryCapture, 500);
      return;
    }

    try {
      const canvas =
        document.createElement("canvas");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context =
        canvas.getContext("2d");

      if (!context) {
        throw new Error(
          "Canvas context unavailable"
        );
      }

      // Draw current remote camera frame
      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const image =
        canvas.toDataURL(
          "image/jpeg",
          0.85
        );

      const timestamp =
        Date.now();

      console.log(
        "📸 Driver evidence captured"
      );

      setCaptureStatus(
        "Evidence captured successfully"
      );

      // Send evidence to FleetDashboard
      window.dispatchEvent(
        new CustomEvent(
          "DRIVER_EVIDENCE_CAPTURED",
          {
            detail: {
              vehicle: vehicleId,
              image,
              width: canvas.width,
              height: canvas.height,
              timestamp,
            },
          }
        )
      );

      // Clear status after 3 seconds
      window.setTimeout(() => {
        setCaptureStatus("");
      }, 3000);
    } catch (error) {
      console.error(
        "❌ Evidence capture failed:",
        error
      );

      setCaptureStatus(
        "Evidence capture failed"
      );

      window.dispatchEvent(
        new CustomEvent(
          "DRIVER_EVIDENCE_CAPTURE_FAILED",
          {
            detail: {
              vehicle: vehicleId,
              reason: error.message,
            },
          }
        )
      );
    }
  };

  // =====================================================
  // LISTEN FOR AUTOMATIC EVIDENCE REQUEST
  // =====================================================

  useEffect(() => {
    const handleCaptureRequest = () => {
      captureEvidence();
    };

    window.addEventListener(
      "CAPTURE_DRIVER_EVIDENCE",
      handleCaptureRequest
    );

    return () => {
      window.removeEventListener(
        "CAPTURE_DRIVER_EVIDENCE",
        handleCaptureRequest
      );
    };
  }, [vehicleId]);

  // =====================================================
  // WEBRTC CONNECTION
  // =====================================================

  useEffect(() => {
    let mounted = true;

    const connectToDriver = async () => {
      try {
        console.log(
          "📹 Admin starting Remote Driver Camera..."
        );

        const socket =
          new WebSocket(
            SIGNALING_SERVER
          );

        socketRef.current = socket;
        adminSocket = socket;

        // =================================================
        // SOCKET OPEN
        // =================================================

        socket.onopen = () => {
          console.log(
            "✅ Admin connected to signaling server"
          );

          socket.send(
            JSON.stringify({
              type: "ADMIN_READY",
              vehicle: vehicleId,
            })
          );

          console.log(
            "📤 ADMIN_READY sent"
          );

          if (mounted) {
            setStatus(
              "WAITING FOR DRIVER"
            );
          }
        };

        // =================================================
        // SOCKET MESSAGE
        // =================================================

        socket.onmessage = async (event) => {
          try {
            const data =
              JSON.parse(
                event.data
              );

            console.log(
              "📨 Admin received:",
              data.type
            );

            // =============================================
            // DRIVER READY
            // =============================================

            if (
              data.type ===
              "DRIVER_READY"
            ) {
              console.log(
                "🚗 Driver is ready:",
                data.vehicle,
                data.driver
              );

              if (mounted) {
                setStatus(
                  "DRIVER READY"
                );
              }

              if (
                socketRef.current &&
                socketRef.current.readyState ===
                  WebSocket.OPEN
              ) {
                socketRef.current.send(
                  JSON.stringify({
                    type: "ADMIN_READY",
                    vehicle:
                      data.vehicle ||
                      vehicleId,
                  })
                );
              }

              return;
            }

            // =============================================
            // DRIVER OFFER
            // =============================================

            if (
              data.type === "OFFER"
            ) {
              console.log(
                "📨 WebRTC OFFER received"
              );

              if (peerRef.current) {
                peerRef.current.close();
                peerRef.current = null;
              }

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

              // =========================================
              // REMOTE VIDEO
              // =========================================

              peer.ontrack = (event) => {
                console.log(
                  "🎥 REMOTE DRIVER VIDEO RECEIVED"
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
                    .then(() => {
                      console.log(
                        "▶️ Remote driver video playing"
                      );
                    })
                    .catch((error) => {
                      console.log(
                        "Video play waiting:",
                        error
                      );
                    });
                }

                if (mounted) {
                  setStatus("LIVE");
                }
              };

              // =========================================
              // ICE
              // =========================================

              peer.onicecandidate = (
                event
              ) => {
                if (
                  event.candidate &&
                  socketRef.current &&
                  socketRef.current.readyState ===
                    WebSocket.OPEN
                ) {
                  socketRef.current.send(
                    JSON.stringify({
                      type:
                        "ICE_CANDIDATE",
                      candidate:
                        event.candidate,
                      vehicle:
                        data.vehicle ||
                        vehicleId,
                    })
                  );
                }
              };

              // =========================================
              // CONNECTION STATE
              // =========================================

              peer.onconnectionstatechange =
                () => {
                  console.log(
                    "🔗 Admin WebRTC state:",
                    peer.connectionState
                  );

                  if (!mounted) {
                    return;
                  }

                  if (
                    peer.connectionState ===
                    "connected"
                  ) {
                    setStatus("LIVE");
                  }

                  if (
                    peer.connectionState ===
                    "disconnected"
                  ) {
                    setStatus(
                      "DISCONNECTED"
                    );
                  }

                  if (
                    peer.connectionState ===
                    "failed"
                  ) {
                    setStatus(
                      "CONNECTION FAILED"
                    );
                  }
                };

              // =========================================
              // ACCEPT OFFER
              // =========================================

              await peer.setRemoteDescription(
                new RTCSessionDescription(
                  data.offer
                )
              );

              console.log(
                "✅ Driver offer accepted"
              );

              const answer =
                await peer.createAnswer();

              await peer.setLocalDescription(
                answer
              );

              if (
                socketRef.current &&
                socketRef.current.readyState ===
                  WebSocket.OPEN
              ) {
                socketRef.current.send(
                  JSON.stringify({
                    type: "ANSWER",
                    answer,
                    vehicle:
                      data.vehicle ||
                      vehicleId,
                  })
                );

                console.log(
                  "📤 ANSWER sent to Driver"
                );
              }

              return;
            }

            // =============================================
            // DRIVER ICE
            // =============================================

            if (
              data.type ===
                "ICE_CANDIDATE" &&
              peerRef.current &&
              data.candidate
            ) {
              try {
                await peerRef.current.addIceCandidate(
                  new RTCIceCandidate(
                    data.candidate
                  )
                );

                console.log(
                  "🧊 Driver ICE candidate added"
                );
              } catch (error) {
                console.error(
                  "❌ ICE candidate error:",
                  error
                );
              }

              return;
            }

            // =============================================
            // ADMIN READY
            // =============================================

            if (
              data.type ===
              "ADMIN_READY"
            ) {
              console.log(
                "✅ Admin ready confirmation received"
              );

              return;
            }
          } catch (error) {
            console.error(
              "❌ Admin WebRTC message error:",
              error
            );
          }
        };

        // =================================================
        // SOCKET ERROR
        // =================================================

        socket.onerror = (error) => {
          console.error(
            "❌ Admin signaling error:",
            error
          );

          if (mounted) {
            setStatus(
              "SIGNALING ERROR"
            );
          }
        };

        // =================================================
        // SOCKET CLOSE
        // =================================================

        socket.onclose = () => {
          console.log(
            "🔌 Admin disconnected"
          );

          if (
            adminSocket === socket
          ) {
            adminSocket = null;
          }

          if (mounted) {
            setStatus(
              "DISCONNECTED"
            );
          }
        };
      } catch (error) {
        console.error(
          "❌ Remote camera error:",
          error
        );

        if (mounted) {
          setStatus("ERROR");
        }
      }
    };

    connectToDriver();

    return () => {
      mounted = false;

      console.log(
        "🧹 Cleaning up Admin Remote Camera"
      );

      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      if (adminSocket) {
        adminSocket = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [vehicleId]);

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="remote-driver-camera">

      <div className="remote-camera-video-wrapper">

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="remote-driver-video"
        />

        {status !== "LIVE" && (
          <div className="remote-camera-overlay">

            <div className="remote-camera-icon">
              📹
            </div>

            <strong>
              DRIVER CAMERA
            </strong>

            <span>
              {status}
            </span>

            {status ===
              "WAITING FOR DRIVER" && (
              <small>
                Waiting for Driver Camera...
              </small>
            )}

            {status ===
              "DRIVER READY" && (
              <small>
                Connecting to Driver Camera...
              </small>
            )}

            {status ===
              "SIGNALING ERROR" && (
              <small>
                Could not connect to signaling server.
              </small>
            )}

            {status ===
              "CONNECTION FAILED" && (
              <small>
                WebRTC connection failed.
              </small>
            )}

          </div>
        )}

        {status === "LIVE" && (
          <div className="remote-live-badge">
            ● LIVE DRIVER FEED
          </div>
        )}

      </div>

      {/* =================================================
          EVIDENCE CONTROLS
      ================================================= */}

      <div className="evidence-controls">

        <button
          type="button"
          className="capture-evidence-button"
          onClick={captureEvidence}
          disabled={status !== "LIVE"}
        >
          📸 Capture Evidence
        </button>

        {captureStatus && (
          <div
            className={
              captureStatus.includes(
                "successfully"
              )
                ? "capture-success"
                : "capture-error"
            }
          >
            {captureStatus.includes(
              "successfully"
            )
              ? "✅ "
              : "⚠️ "}

            {captureStatus}
          </div>
        )}

      </div>

    </div>
  );
}

export default RemoteDriverCamera;