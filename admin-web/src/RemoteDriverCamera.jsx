import { useEffect, useRef, useState } from "react";

const SIGNALING_SERVER = "wss://guardian-transit.onrender.com";

let adminSocket = null;

// =====================================================
// SEND COMMAND TO DRIVER
// =====================================================

export function sendDriverCommand(command, vehicle) {
  if (
    !adminSocket ||
    adminSocket.readyState !== WebSocket.OPEN
  ) {
    console.error("❌ Admin WebSocket is not connected");
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

  const pendingIceCandidatesRef = useRef([]);

  const activeOfferRef = useRef(null);

  const remoteDescriptionReadyRef = useRef(false);

  const mountedRef = useRef(true);

  const adminReadySentRef = useRef(false);

  const offerProcessingRef = useRef(false);

  const [status, setStatus] = useState("CONNECTING");
  const [captureStatus, setCaptureStatus] = useState("");

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

        if (attempts < 10) {
          window.setTimeout(
            retryCapture,
            500
          );

          return;
        }

        console.error(
          "❌ Driver camera did not become ready"
        );

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

      window.setTimeout(
        retryCapture,
        500
      );

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

      window.setTimeout(() => {
        if (mountedRef.current) {
          setCaptureStatus("");
        }
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
              reason:
                error?.message ||
                "Unknown capture error",
            },
          }
        )
      );
    }
  };

  // =====================================================
  // AUTOMATIC EVIDENCE REQUEST
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

    mountedRef.current = true;

    adminReadySentRef.current = false;
    offerProcessingRef.current = false;

    // ===================================================
    // CLEANUP PEER
    // ===================================================

    const cleanupPeer = () => {
      remoteDescriptionReadyRef.current = false;
      pendingIceCandidatesRef.current = [];
      activeOfferRef.current = null;
      offerProcessingRef.current = false;

      if (peerRef.current) {
        try {
          peerRef.current.ontrack = null;
          peerRef.current.onicecandidate = null;
          peerRef.current.onconnectionstatechange = null;
          peerRef.current.oniceconnectionstatechange = null;

          peerRef.current.close();
        } catch (error) {
          console.warn(
            "Peer cleanup warning:",
            error
          );
        }

        peerRef.current = null;
      }

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // Ignore
        }

        videoRef.current.srcObject = null;
      }
    };

    // ===================================================
    // SEND ADMIN READY ONCE
    // ===================================================

    const sendAdminReady = (socket) => {
      if (
        !mounted ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      if (adminReadySentRef.current) {
        console.log(
          "⚠️ ADMIN_READY already sent - ignoring duplicate"
        );

        return;
      }

      adminReadySentRef.current = true;

      socket.send(
        JSON.stringify({
          type: "ADMIN_READY",
          vehicle: vehicleId,
        })
      );

      console.log(
        "📤 ADMIN_READY sent:",
        {
          type: "ADMIN_READY",
          vehicle: vehicleId,
        }
      );
    };

    // ===================================================
    // FLUSH QUEUED ICE
    // ===================================================

    const flushPendingIceCandidates =
      async (peer) => {
        const candidates =
          pendingIceCandidatesRef.current;

        pendingIceCandidatesRef.current = [];

        if (!candidates.length) {
          return;
        }

        console.log(
          `🧊 Adding ${candidates.length} queued ICE candidate(s)`
        );

        for (const candidate of candidates) {
          try {
            await peer.addIceCandidate(
              new RTCIceCandidate(candidate)
            );

            console.log(
              "🧊 Queued ICE candidate added"
            );
          } catch (error) {
            console.error(
              "❌ Queued ICE candidate error:",
              error
            );
          }
        }
      };

    // ===================================================
    // CONNECT TO SIGNALING SERVER
    // ===================================================

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
          if (!mounted) {
            return;
          }

          console.log(
            "✅ Admin connected to signaling server"
          );

          setStatus(
            "WAITING FOR DRIVER"
          );

          // IMPORTANT:
          // Send ADMIN_READY exactly once.
          sendAdminReady(socket);
        };

        // =================================================
        // SOCKET MESSAGE
        // =================================================

        socket.onmessage = async (event) => {
          if (!mounted) {
            return;
          }

          try {
            const data =
              JSON.parse(event.data);

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

              setStatus(
                "DRIVER READY"
              );

              // DO NOT send ADMIN_READY again.
              //
              // The previous version did this here,
              // causing duplicate ADMIN_READY messages.
              //
              // The original ADMIN_READY sent on socket
              // open is sufficient.

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

              const offerId =
                data.offer?.sdp ||
                JSON.stringify(
                  data.offer
                );

              // -------------------------------------------
              // DUPLICATE OFFER
              // -------------------------------------------

              if (
                activeOfferRef.current ===
                  offerId
              ) {
                console.log(
                  "⚠️ Duplicate OFFER ignored"
                );

                return;
              }

              // Prevent simultaneous OFFER processing.
              if (
                offerProcessingRef.current
              ) {
                console.log(
                  "⚠️ WebRTC OFFER already being processed"
                );

                return;
              }

              offerProcessingRef.current = true;

              activeOfferRef.current =
                offerId;

              // -------------------------------------------
              // CLOSE OLD PEER
              // -------------------------------------------

              if (peerRef.current) {
                console.log(
                  "♻️ Closing previous WebRTC connection"
                );

                try {
                  peerRef.current.close();
                } catch {
                  // Ignore
                }

                peerRef.current = null;
              }

              remoteDescriptionReadyRef.current =
                false;

              pendingIceCandidatesRef.current =
                [];

              // -------------------------------------------
              // CREATE PEER
              // -------------------------------------------

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

              console.log(
                "🆕 New Admin RTCPeerConnection created"
              );

              // =========================================
              // REMOTE VIDEO
              // =========================================

              peer.ontrack = (event) => {
                console.log(
                  "🎥 REMOTE DRIVER VIDEO RECEIVED"
                );

                if (
                  !videoRef.current ||
                  !event.streams ||
                  !event.streams[0]
                ) {
                  return;
                }

                const video =
                  videoRef.current;

                const remoteStream =
                  event.streams[0];

                if (
                  video.srcObject !==
                  remoteStream
                ) {
                  video.srcObject =
                    remoteStream;
                }

                const markVideoReady =
                  () => {
                    if (!mounted) {
                      return;
                    }

                    if (
                      video.videoWidth &&
                      video.videoHeight
                    ) {
                      console.log(
                        `🎥 Remote video ready: ${video.videoWidth}x${video.videoHeight}`
                      );

                      setStatus(
                        "LIVE"
                      );
                    }
                  };

                video.onloadedmetadata =
                  () => {
                    console.log(
                      "📐 Remote video metadata loaded"
                    );

                    markVideoReady();

                    video
                      .play()
                      .then(() => {
                        console.log(
                          "▶️ Remote driver video playing"
                        );

                        markVideoReady();
                      })
                      .catch((error) => {
                        console.log(
                          "Video play waiting:",
                          error
                        );
                      });
                  };

                video
                  .play()
                  .then(() => {
                    console.log(
                      "▶️ Remote driver video playing"
                    );

                    markVideoReady();
                  })
                  .catch((error) => {
                    console.log(
                      "Video play waiting:",
                      error
                    );
                  });
              };

              // =========================================
              // ADMIN ICE
              // =========================================

              peer.onicecandidate =
                (event) => {
                  if (
                    !event.candidate
                  ) {
                    return;
                  }

                  if (
                    socket.readyState !==
                    WebSocket.OPEN
                  ) {
                    console.warn(
                      "⚠️ Cannot send ICE: socket not open"
                    );

                    return;
                  }

                  socket.send(
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

                  console.log(
                    "📤 Admin ICE candidate sent"
                  );
                };

              // =========================================
              // ICE CONNECTION STATE
              // =========================================

              peer.oniceconnectionstatechange =
                () => {
                  console.log(
                    "🧊 Admin ICE state:",
                    peer.iceConnectionState
                  );

                  if (!mounted) {
                    return;
                  }

                  if (
                    peer.iceConnectionState ===
                    "checking"
                  ) {
                    setStatus(
                      "CONNECTING"
                    );
                  }

                  if (
                    peer.iceConnectionState ===
                      "connected" ||
                    peer.iceConnectionState ===
                      "completed"
                  ) {
                    console.log(
                      "✅ Admin ICE connection established"
                    );
                  }

                  if (
                    peer.iceConnectionState ===
                    "disconnected"
                  ) {
                    console.warn(
                      "⚠️ Admin ICE disconnected"
                    );

                    setStatus(
                      "DISCONNECTED"
                    );
                  }

                  if (
                    peer.iceConnectionState ===
                    "failed"
                  ) {
                    console.error(
                      "❌ Admin ICE connection failed"
                    );

                    setStatus(
                      "CONNECTION FAILED"
                    );
                  }

                  if (
                    peer.iceConnectionState ===
                    "closed"
                  ) {
                    setStatus(
                      "DISCONNECTED"
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
                      "new" ||
                    peer.connectionState ===
                      "connecting"
                  ) {
                    setStatus(
                      "CONNECTING"
                    );
                  }

                  if (
                    peer.connectionState ===
                    "connected"
                  ) {
                    console.log(
                      "✅ Admin WebRTC connected"
                    );

                    if (
                      videoRef.current &&
                      videoRef.current.videoWidth
                    ) {
                      setStatus(
                        "LIVE"
                      );
                    } else {
                      setStatus(
                        "DRIVER READY"
                      );
                    }
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
                    console.error(
                      "❌ Admin WebRTC connection failed"
                    );

                    setStatus(
                      "CONNECTION FAILED"
                    );
                  }

                  if (
                    peer.connectionState ===
                    "closed"
                  ) {
                    setStatus(
                      "DISCONNECTED"
                    );
                  }
                };

              // =========================================
              // ACCEPT OFFER
              // =========================================

              try {
                await peer.setRemoteDescription(
                  new RTCSessionDescription(
                    data.offer
                  )
                );

                console.log(
                  "✅ Driver offer accepted"
                );

                remoteDescriptionReadyRef.current =
                  true;

                // =======================================
                // ADD QUEUED DRIVER ICE
                // =======================================

                await flushPendingIceCandidates(
                  peer
                );

                // =======================================
                // CREATE ANSWER
                // =======================================

                const answer =
                  await peer.createAnswer();

                await peer.setLocalDescription(
                  answer
                );

                console.log(
                  "✅ Admin local description created"
                );

                // =======================================
                // SEND ANSWER
                // =======================================

                if (
                  socket.readyState ===
                  WebSocket.OPEN
                ) {
                  socket.send(
                    JSON.stringify({
                      type:
                        "ANSWER",
                      answer:
                        peer.localDescription,
                      vehicle:
                        data.vehicle ||
                        vehicleId,
                    })
                  );

                  console.log(
                    "📤 ANSWER sent to Driver"
                  );
                }
              } catch (error) {
                console.error(
                  "❌ Failed to process Driver OFFER:",
                  error
                );

                setStatus(
                  "CONNECTION FAILED"
                );
              } finally {
                offerProcessingRef.current =
                  false;
              }

              return;
            }

            // =============================================
            // DRIVER ICE CANDIDATE
            // =============================================

            if (
              data.type ===
                "ICE_CANDIDATE" &&
              data.candidate
            ) {
              const peer =
                peerRef.current;

              if (!peer) {
                console.warn(
                  "⚠️ ICE candidate received before peer creation"
                );

                return;
              }

              if (
                !remoteDescriptionReadyRef.current
              ) {
                console.log(
                  "⏳ Queueing ICE candidate until remote description is ready"
                );

                pendingIceCandidatesRef.current.push(
                  data.candidate
                );

                return;
              }

              try {
                await peer.addIceCandidate(
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
            // ADMIN READY CONFIRMATION
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

    // =====================================================
    // CLEANUP
    // =====================================================

    return () => {
      mounted = false;
      mountedRef.current = false;

      console.log(
        "🧹 Cleaning up Admin Remote Camera"
      );

      remoteDescriptionReadyRef.current =
        false;

      pendingIceCandidatesRef.current =
        [];

      activeOfferRef.current = null;

      offerProcessingRef.current =
        false;

      adminReadySentRef.current =
        false;

      if (peerRef.current) {
        try {
          peerRef.current.close();
        } catch {
          // Ignore
        }

        peerRef.current = null;
      }

      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // Ignore
        }

        socketRef.current = null;
      }

      if (
        adminSocket &&
        adminSocket.readyState !==
          WebSocket.CLOSED
      ) {
        try {
          adminSocket.close();
        } catch {
          // Ignore
        }
      }

      adminSocket = null;

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // Ignore
        }

        videoRef.current.srcObject =
          null;

        videoRef.current.onloadedmetadata =
          null;
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
              "CONNECTING" && (
              <small>
                Establishing secure video connection...
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

            {status ===
              "DISCONNECTED" && (
              <small>
                Driver camera disconnected.
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