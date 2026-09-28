import { useEffect, useRef } from "react";

const SIGNALING_SERVER =
  "wss://guardian-transit.onrender.com";

let driverSocket = null;

// =====================================================
// SEND DRIVER TELEMETRY
// =====================================================

export function sendDriverTelemetry(telemetry) {
  if (
    !driverSocket ||
    driverSocket.readyState !== WebSocket.OPEN
  ) {
    console.log(
      "⚠️ Telemetry socket not ready"
    );

    return false;
  }

  driverSocket.send(
    JSON.stringify({
      type: "DRIVER_TELEMETRY",
      ...telemetry,
      timestamp:
        telemetry.timestamp || Date.now(),
    })
  );

  console.log(
    "📡 Driver telemetry sent:",
    telemetry
  );

  return true;
}

// =====================================================
// CAMERA BROADCASTER
// =====================================================

function CameraBroadcaster({ stream }) {
  const socketRef = useRef(null);
  const peerRef = useRef(null);

  // Prevent multiple offers.
  const offerSentRef = useRef(false);

  // Prevent multiple connection attempts.
  const connectingRef = useRef(false);

  // Track whether the driver's remote description
  // (Admin answer) has been received.
  const remoteDescriptionReadyRef =
    useRef(false);

  // ICE candidates can arrive before the answer.
  const pendingIceCandidatesRef =
    useRef([]);

  useEffect(() => {
    if (!stream) {
      return;
    }

    let mounted = true;

    // ===================================================
    // CLEANUP PEER
    // ===================================================

    const cleanupPeer = () => {
      remoteDescriptionReadyRef.current =
        false;

      pendingIceCandidatesRef.current = [];

      if (peerRef.current) {
        try {
          peerRef.current.onicecandidate =
            null;

          peerRef.current.onconnectionstatechange =
            null;

          peerRef.current.oniceconnectionstatechange =
            null;

          peerRef.current.close();
        } catch {
          // Ignore cleanup errors.
        }

        peerRef.current = null;
      }

      connectingRef.current = false;
      offerSentRef.current = false;
    };

    // ===================================================
    // ADD QUEUED ICE CANDIDATES
    // ===================================================

    const flushPendingIceCandidates =
      async (peer) => {
        const candidates =
          pendingIceCandidatesRef.current;

        pendingIceCandidatesRef.current =
          [];

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
    // CREATE WEBRTC OFFER
    // ===================================================

    const createOffer = async () => {
      try {
        if (!mounted || !stream) {
          return;
        }

        const socket =
          socketRef.current;

        if (
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        ) {
          console.log(
            "⚠️ Cannot create offer: socket not ready"
          );

          return;
        }

        // -----------------------------------------------
        // PREVENT DUPLICATE OFFERS
        // -----------------------------------------------

        if (offerSentRef.current) {
          console.log(
            "⚠️ WebRTC offer already sent - ignoring duplicate ADMIN_READY"
          );

          return;
        }

        if (connectingRef.current) {
          console.log(
            "⚠️ WebRTC connection already being created"
          );

          return;
        }

        connectingRef.current = true;

        console.log(
          "🎥 Creating Driver WebRTC connection..."
        );

        // -----------------------------------------------
        // CREATE PEER
        // -----------------------------------------------

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

        // -----------------------------------------------
        // ADD CAMERA TRACKS
        // -----------------------------------------------

        stream
          .getTracks()
          .forEach((track) => {
            console.log(
              "🎥 Adding driver track:",
              track.kind,
              track.readyState
            );

            peer.addTrack(
              track,
              stream
            );
          });

        // -----------------------------------------------
        // SEND ICE CANDIDATES
        // -----------------------------------------------

        peer.onicecandidate =
          (event) => {
            if (
              !event.candidate
            ) {
              return;
            }

            const currentSocket =
              socketRef.current;

            if (
              !currentSocket ||
              currentSocket.readyState !==
                WebSocket.OPEN
            ) {
              console.warn(
                "⚠️ Driver socket not ready for ICE candidate"
              );

              return;
            }

            currentSocket.send(
              JSON.stringify({
                type:
                  "ICE_CANDIDATE",
                candidate:
                  event.candidate,
                vehicle:
                  "BUS-101",
              })
            );

            console.log(
              "📤 Driver ICE candidate sent"
            );
          };

        // -----------------------------------------------
        // ICE CONNECTION STATE
        // -----------------------------------------------

        peer.oniceconnectionstatechange =
          () => {
            console.log(
              "🧊 Driver ICE state:",
              peer.iceConnectionState
            );

            if (
              peer.iceConnectionState ===
                "connected" ||
              peer.iceConnectionState ===
                "completed"
            ) {
              console.log(
                "✅ Driver ICE connection established"
              );
            }

            if (
              peer.iceConnectionState ===
              "disconnected"
            ) {
              console.warn(
                "⚠️ Driver ICE disconnected"
              );
            }

            if (
              peer.iceConnectionState ===
              "failed"
            ) {
              console.error(
                "❌ Driver ICE connection failed"
              );
            }
          };

        // -----------------------------------------------
        // WEBRTC CONNECTION STATE
        // -----------------------------------------------

        peer.onconnectionstatechange =
          () => {
            console.log(
              "🔗 Driver WebRTC state:",
              peer.connectionState
            );

            if (
              peer.connectionState ===
              "connected"
            ) {
              console.log(
                "✅ Driver WebRTC connected to Fleet"
              );
            }

            if (
              peer.connectionState ===
              "failed"
            ) {
              console.error(
                "❌ Driver WebRTC connection failed"
              );

              // Allow a future ADMIN_READY to create
              // a new connection if necessary.
              connectingRef.current =
                false;
              offerSentRef.current =
                false;
            }

            if (
              peer.connectionState ===
              "closed"
            ) {
              connectingRef.current =
                false;
            }
          };

        // -----------------------------------------------
        // CREATE OFFER
        // -----------------------------------------------

        const offer =
          await peer.createOffer();

        await peer.setLocalDescription(
          offer
        );

        console.log(
          "✅ Driver local description created"
        );

        // -----------------------------------------------
        // SEND OFFER
        // -----------------------------------------------

        if (
          socket.readyState ===
          WebSocket.OPEN
        ) {
          socket.send(
            JSON.stringify({
              type: "OFFER",
              offer:
                peer.localDescription,
              vehicle:
                "BUS-101",
              driver:
                "Driver A",
            })
          );

          offerSentRef.current =
            true;

          console.log(
            "📤 WebRTC OFFER sent"
          );
        } else {
          console.error(
            "❌ Socket closed before OFFER could be sent"
          );

          connectingRef.current =
            false;
        }
      } catch (error) {
        console.error(
          "❌ Offer creation error:",
          error
        );

        connectingRef.current =
          false;

        offerSentRef.current =
          false;
      }
    };

    // ===================================================
    // CONNECT TO SIGNALING SERVER
    // ===================================================

    const connectToServer = () => {
      try {
        console.log(
          "🎥 Starting Driver Camera Broadcaster..."
        );

        const socket =
          new WebSocket(
            SIGNALING_SERVER
          );

        socketRef.current =
          socket;

        driverSocket =
          socket;

        // ===============================================
        // SOCKET OPEN
        // ===============================================

        socket.onopen = () => {
          if (!mounted) {
            return;
          }

          console.log(
            "✅ Driver connected to signaling server"
          );

          socket.send(
            JSON.stringify({
              type:
                "DRIVER_READY",
              vehicle:
                "BUS-101",
              driver:
                "Driver A",
            })
          );

          console.log(
            "📤 DRIVER_READY sent"
          );
        };

        // ===============================================
        // SOCKET MESSAGE
        // ===============================================

        socket.onmessage =
          async (event) => {
            if (!mounted) {
              return;
            }

            try {
              const data =
                JSON.parse(
                  event.data
                );

              console.log(
                "📨 Driver received:",
                data.type
              );

              // =========================================
              // ADMIN READY
              // =========================================

              if (
                data.type ===
                "ADMIN_READY"
              ) {
                console.log(
                  "🖥️ Admin is ready for Driver camera"
                );

                await createOffer();

                return;
              }

              // =========================================
              // WEBRTC ANSWER
              // =========================================

              if (
                data.type ===
                "ANSWER"
              ) {
                const peer =
                  peerRef.current;

                if (!peer) {
                  console.warn(
                    "⚠️ ANSWER received but no peer exists"
                  );

                  return;
                }

                if (
                  peer.signalingState !==
                  "have-local-offer"
                ) {
                  console.warn(
                    "⚠️ Ignoring ANSWER because signaling state is:",
                    peer.signalingState
                  );

                  return;
                }

                await peer.setRemoteDescription(
                  new RTCSessionDescription(
                    data.answer
                  )
                );

                console.log(
                  "✅ WebRTC ANSWER received"
                );

                remoteDescriptionReadyRef.current =
                  true;

                // -----------------------------------------
                // ADD QUEUED ICE
                // -----------------------------------------

                await flushPendingIceCandidates(
                  peer
                );

                console.log(
                  "🧊 Driver queued ICE processing complete"
                );

                return;
              }

              // =========================================
              // ICE CANDIDATE
              // =========================================

              if (
                data.type ===
                  "ICE_CANDIDATE" &&
                data.candidate
              ) {
                const peer =
                  peerRef.current;

                if (!peer) {
                  console.warn(
                    "⚠️ Driver received ICE before peer exists"
                  );

                  return;
                }

                // -----------------------------------------
                // QUEUE ICE UNTIL ANSWER EXISTS
                // -----------------------------------------

                if (
                  !remoteDescriptionReadyRef.current
                ) {
                  console.log(
                    "⏳ Queueing Driver ICE candidate until ANSWER is received"
                  );

                  pendingIceCandidatesRef.current.push(
                    data.candidate
                  );

                  return;
                }

                // -----------------------------------------
                // ADD ICE
                // -----------------------------------------

                try {
                  await peer.addIceCandidate(
                    new RTCIceCandidate(
                      data.candidate
                    )
                  );

                  console.log(
                    "🧊 ICE candidate added"
                  );
                } catch (error) {
                  console.error(
                    "❌ ICE candidate error:",
                    error
                  );
                }

                return;
              }

              // =========================================
              // AUDIO ALERT
              // =========================================

              if (
                data.type ===
                "AUDIO_ALERT"
              ) {
                console.log(
                  "🔊 AUDIO ALERT received"
                );

                window.dispatchEvent(
                  new CustomEvent(
                    "guardianTransitAudioAlert",
                    {
                      detail:
                        data,
                    }
                  )
                );

                return;
              }

              // =========================================
              // REPLACE VEHICLE
              // =========================================

              if (
                data.type ===
                "REPLACE_VEHICLE"
              ) {
                console.log(
                  "🚨 REPLACE VEHICLE received"
                );

                window.dispatchEvent(
                  new CustomEvent(
                    "guardianTransitReplaceVehicle",
                    {
                      detail:
                        data,
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

        // ===============================================
        // SOCKET ERROR
        // ===============================================

        socket.onerror =
          (error) => {
            console.error(
              "❌ Signaling server error:",
              error
            );
          };

        // ===============================================
        // SOCKET CLOSE
        // ===============================================

        socket.onclose = () => {
          console.log(
            "🔌 Driver disconnected from signaling server"
          );

          if (
            driverSocket ===
            socket
          ) {
            driverSocket =
              null;
          }
        };
      } catch (error) {
        console.error(
          "❌ Broadcaster connection error:",
          error
        );
      }
    };

    connectToServer();

    // ===================================================
    // CLEANUP
    // ===================================================

    return () => {
      mounted = false;

      console.log(
        "🧹 Cleaning up Driver Camera Broadcaster"
      );

      cleanupPeer();

      const currentSocket =
        socketRef.current;

      if (currentSocket) {
        try {
          currentSocket.close();
        } catch {
          // Ignore cleanup errors.
        }
      }

      if (
        driverSocket ===
        currentSocket
      ) {
        driverSocket = null;
      }

      socketRef.current =
        null;
    };
  }, [stream]);

  return null;
}

export default CameraBroadcaster;