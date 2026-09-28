import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./FleetDashboard.css";

import FleetTelemetry from "./FleetTelemetry";

import RemoteDriverCamera, {
  sendDriverCommand,
} from "./RemoteDriverCamera";
import FleetMap from "./FleetMap";

// ============================================================
// INITIAL VEHICLES
// ============================================================

const initialVehicles = [
  {
    id: "BUS-101",
    driver: "Driver A",
    route: "401",
    status: "ACTIVE",
    risk: 18,
    speed: 42,
    location: "Yelahanka",
    replacementStatus: "NORMAL",
  },
  {
    id: "BUS-102",
    driver: "Driver B",
    route: "500",
    status: "WARNING",
    risk: 61,
    speed: 36,
    location: "Hebbal",
    replacementStatus: "NORMAL",
  },
  {
    id: "BUS-103",
    driver: "Driver C",
    route: "290",
    status: "CRITICAL",
    risk: 92,
    speed: 18,
    location: "Majestic",
    replacementStatus: "REPLACEMENT REQUIRED",
  },
];

// ============================================================
// INITIAL INCIDENTS
// ============================================================

const initialIncidents = [
  {
    id: 1,
    type: "Micro-sleep detected",
    vehicle: "BUS-103",
    driver: "Driver C",
    severity: "critical",
    time: "2 min ago",
  },
  {
    id: 2,
    type: "Extended eye closure",
    vehicle: "BUS-102",
    driver: "Driver B",
    severity: "warning",
    time: "8 min ago",
  },
  {
    id: 3,
    type: "Yawn detected",
    vehicle: "BUS-101",
    driver: "Driver A",
    severity: "info",
    time: "15 min ago",
  },
];

// ============================================================
// HELPERS
// ============================================================

const clamp = (value, min, max) =>
  Math.min(Math.max(value, min), max);

const getStatusFromRisk = (risk) => {
  if (risk >= 80) {
    return "CRITICAL";
  }

  if (risk >= 50) {
    return "WARNING";
  }

  return "ACTIVE";
};

const getSafetyScore = (risk) =>
  clamp(100 - risk, 0, 100);

const getSafetyLabel = (score) => {
  if (score >= 85) {
    return "EXCELLENT";
  }

  if (score >= 70) {
    return "GOOD";
  }

  if (score >= 50) {
    return "MODERATE";
  }

  return "HIGH RISK";
};

const getTrend = (history = []) => {
  if (history.length < 2) {
    return "STABLE";
  }

  const recent = history.slice(-5);

  const first = recent[0];
  const last = recent[recent.length - 1];

  const difference = last - first;

  if (difference >= 8) {
    return "RISING";
  }

  if (difference <= -8) {
    return "IMPROVING";
  }

  return "STABLE";
};

const getPrediction = (
  vehicle,
  history = []
) => {
  const recentHistory = [
    ...history,
    vehicle.risk,
  ].slice(-5);

  if (recentHistory.length < 2) {
    return {
      predictedRisk: vehicle.risk,
      trend: "STABLE",
      level: getStatusFromRisk(vehicle.risk),
      forecast: "5-minute forecast unavailable",
    };
  }

  let totalChange = 0;

  for (
    let index = 1;
    index < recentHistory.length;
    index += 1
  ) {
    totalChange +=
      recentHistory[index] -
      recentHistory[index - 1];
  }

  const averageChange =
    totalChange /
    (recentHistory.length - 1);

  const predictedRisk = Math.round(
    clamp(
      vehicle.risk +
        averageChange * 3,
      0,
      99
    )
  );

  const trend =
    averageChange >= 2
      ? "RISING"
      : averageChange <= -2
      ? "IMPROVING"
      : "STABLE";

  let forecast =
    "Risk expected to remain stable";

  if (predictedRisk >= 80) {
    forecast =
      "Vehicle may enter critical risk";
  } else if (predictedRisk >= 50) {
    forecast =
      "Vehicle may enter warning risk";
  } else if (trend === "IMPROVING") {
    forecast =
      "Risk expected to improve";
  }

  return {
    predictedRisk,
    trend,
    level: getStatusFromRisk(
      predictedRisk
    ),
    forecast,
  };
};

// ============================================================
// ALERT SOUND
// ============================================================

function playAlertSound(
  type = "warning"
) {
  try {
    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext) {
      return;
    }

    const audioContext =
      new AudioContext();

    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    oscillator.connect(gain);

    gain.connect(
      audioContext.destination
    );

    if (type === "critical") {
      oscillator.type = "square";

      oscillator.frequency.setValueAtTime(
        1000,
        audioContext.currentTime
      );

      oscillator.frequency.setValueAtTime(
        650,
        audioContext.currentTime + 0.3
      );

      oscillator.frequency.setValueAtTime(
        1000,
        audioContext.currentTime + 0.6
      );

      gain.gain.setValueAtTime(
        0.25,
        audioContext.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.9
      );

      oscillator.start();

      oscillator.stop(
        audioContext.currentTime + 0.9
      );
    } else {
      oscillator.type = "sine";

      oscillator.frequency.setValueAtTime(
        700,
        audioContext.currentTime
      );

      gain.gain.setValueAtTime(
        0.2,
        audioContext.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.45
      );

      oscillator.start();

      oscillator.stop(
        audioContext.currentTime + 0.45
      );
    }
  } catch (error) {
    console.log(
      "Alert sound unavailable:",
      error
    );
  }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

function FleetDashboard() {
  // ==========================================================
  // CORE STATE
  // ==========================================================

  const [vehicles, setVehicles] =
    useState(initialVehicles);

  const [selectedVehicle, setSelectedVehicle] =
    useState(initialVehicles[0]);

  const [incidents, setIncidents] =
    useState(initialIncidents);

  const [message, setMessage] =
    useState("");

  const [driverLiveStatus, setDriverLiveStatus] =
    useState({
      status: "DRIVER FOCUSED",
      risk: 15,
      vehicle: "BUS-101",
      driver: "Driver A",
      eyeStatus: "NORMAL",
      headStatus: "FOCUSED",
      yawns: 0,
    });

  // ==========================================================
  // EVIDENCE
  // ==========================================================

  const [evidenceVisible, setEvidenceVisible] =
    useState(false);

  const [evidenceData, setEvidenceData] =
    useState(null);

  const [capturedEvidence, setCapturedEvidence] =
    useState(null);

  // ==========================================================
  // INTERVENTION AUDIT LOG
  // ==========================================================

  const [interventionAudit, setInterventionAudit] =
    useState([
      {
        id: 1,
        action: "SYSTEM INITIALIZED",
        vehicle: "FLEET",
        time: new Date().toLocaleString(),
      },
    ]);

  // ==========================================================
  // SIMULATION
  // ==========================================================

  const [simulationRunning, setSimulationRunning] =
    useState(true);

  // ==========================================================
  // RISK HISTORY
  // ==========================================================

  const [riskHistory, setRiskHistory] =
    useState({
      "BUS-101": [
        18,
        20,
        17,
        22,
        19,
        18,
      ],

      "BUS-102": [
        48,
        52,
        56,
        58,
        61,
        61,
      ],

      "BUS-103": [
        65,
        72,
        79,
        86,
        91,
        92,
      ],
    });

  // ==========================================================
  // PREDICTIVE ALERT TRACKING
  // ==========================================================

  const predictionAlerts =
    useRef(new Set());

  // ==========================================================
  // AUTOMATIC CRITICAL RESPONSE TRACKING
  // ==========================================================

  const criticalProcessedVehicles =
    useRef(new Set());

  // ==========================================================
  // NOTIFICATIONS
  // ==========================================================

  const [notifications, setNotifications] =
    useState([]);

  const notificationId =
    useRef(0);

  // ==========================================================
  // MESSAGE HELPER
  // ==========================================================

  const showMessage = (
    text,
    duration = 4000
  ) => {
    setMessage(text);

    window.setTimeout(() => {
      setMessage("");
    }, duration);
  };

  // ==========================================================
  // NOTIFICATION HELPER
  // ==========================================================

  const addNotification = (
    title,
    text,
    type = "info"
  ) => {
    const id =
      notificationId.current + 1;

    notificationId.current = id;

    const notification = {
      id,
      title,
      text,
      type,
      time: new Date().toLocaleTimeString(),
    };

    setNotifications((current) => [
      notification,
      ...current,
    ]);

    window.setTimeout(() => {
      setNotifications((current) =>
        current.filter(
          (item) =>
            item.id !== id
        )
      );
    }, 7000);
  };

  // ==========================================================
  // RECORD INTERVENTION AUDIT
  // ==========================================================

  const recordAudit = (action, vehicle) => {
    setInterventionAudit((current) => [
      {
        id: Date.now() + Math.random(),
        action,
        vehicle: vehicle || "FLEET",
        time: new Date().toLocaleString(),
      },
      ...current,
    ].slice(0, 20));
  };

  // ==========================================================
  // RECORD RISK HISTORY
  // ==========================================================

  const recordRisk = (
    vehicleId,
    risk
  ) => {
    setRiskHistory((current) => {
      const history =
        current[vehicleId] || [];

      return {
        ...current,
        [vehicleId]: [
          ...history.slice(-5),
          risk,
        ],
      };
    });
  };

  // ==========================================================
  // RECEIVE REAL-TIME WEBSOCKET TELEMETRY
  // ==========================================================

  const receiveTelemetry = (
    data
  ) => {
    console.log(
      "📡 LIVE DRIVER TELEMETRY:",
      data
    );

    const vehicleId =
      data.vehicle || "BUS-101";

    const driver =
      data.driver || "Driver A";

    const risk = Number(
      data.risk ?? 15
    );

    const status =
      getStatusFromRisk(risk);

    setDriverLiveStatus({
      status:
        data.status ||
        "DRIVER FOCUSED",

      risk,

      vehicle: vehicleId,

      driver,

      eyeStatus:
        data.eyeStatus ||
        "NORMAL",

      headStatus:
        data.headStatus ||
        "FOCUSED",

      yawns: Number(
        data.yawns ?? 0
      ),
    });

    recordRisk(
      vehicleId,
      risk
    );

    setVehicles(
      (currentVehicles) =>
        currentVehicles.map(
          (vehicle) => {
            if (
              vehicle.id !==
              vehicleId
            ) {
              return vehicle;
            }

            return {
              ...vehicle,
              risk,
              status,
              driver,
            };
          }
        )
    );

    setSelectedVehicle(
      (currentSelected) => {
        if (
          currentSelected.id !==
          vehicleId
        ) {
          return currentSelected;
        }

        return {
          ...currentSelected,
          risk,
          status,
          driver,
        };
      }
    );

    // --------------------------------------------------------
    // CREATE INCIDENT FROM AI STATUS
    // --------------------------------------------------------

    if (
      data.status ===
        "MICRO-SLEEP DETECTED" ||
      data.status ===
        "EYES CLOSED" ||
      data.status ===
        "YAWN DETECTED" ||
      data.status ===
        "FACE NOT DETECTED"
    ) {
      const severity =
        data.status ===
        "MICRO-SLEEP DETECTED"
          ? "critical"
          : "warning";

      const newIncident = {
        id:
          Date.now() +
          Math.random(),

        type: data.status,

        vehicle: vehicleId,

        driver,

        severity,

        time: "Just now",
      };

      setIncidents((current) => [
        newIncident,
        ...current,
      ]);

      if (
        data.status ===
        "MICRO-SLEEP DETECTED"
      ) {
        setEvidenceVisible(true);

        setEvidenceData({
          event: data.status,
          vehicle: vehicleId,
          driver,
          severity: "critical",
          risk,
          timestamp:
            new Date().toLocaleString(),
        });

        playAlertSound(
          "critical"
        );

        addNotification(
          "CRITICAL DRIVER EVENT",
          `${vehicleId} reported micro-sleep detection`,
          "critical"
        );

        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("CAPTURE_DRIVER_EVIDENCE")
          );
        }, 1200);
      } else if (
        data.status ===
        "EYES CLOSED"
      ) {
        playAlertSound(
          "warning"
        );

        addNotification(
          "DRIVER WARNING",
          `${vehicleId}: extended eye closure detected`,
          "warning"
        );
      } else if (
        data.status ===
        "YAWN DETECTED"
      ) {
        addNotification(
          "FATIGUE EVENT",
          `${vehicleId}: yawn detected`,
          "warning"
        );
      }
    }
  };

  // ==========================================================
  // RECEIVE LOCAL STORAGE DRIVER STATUS
  // ==========================================================

  useEffect(() => {
    const receiveDriverStatus =
      (event) => {
        if (
          event.key !==
          "guardianTransitDriverStatus"
        ) {
          return;
        }

        if (!event.newValue) {
          return;
        }

        try {
          const data =
            JSON.parse(
              event.newValue
            );

          const vehicleId =
            data.vehicle ||
            "BUS-101";

          const risk = Number(
            data.risk ?? 15
          );

          const status =
            getStatusFromRisk(risk);

          setDriverLiveStatus(
            data
          );

          recordRisk(
            vehicleId,
            risk
          );

          setVehicles(
            (current) =>
              current.map(
                (vehicle) => {
                  if (
                    vehicle.id !==
                    vehicleId
                  ) {
                    return vehicle;
                  }

                  const updated = {
                    ...vehicle,
                    risk,
                    status,
                    driver:
                      data.driver ||
                      vehicle.driver,
                  };

                  if (
                    selectedVehicle.id ===
                    vehicle.id
                  ) {
                    setSelectedVehicle(
                      updated
                    );
                  }

                  return updated;
                }
              )
          );
        } catch (error) {
          console.error(
            "Driver status error:",
            error
          );
        }
      };

    window.addEventListener(
      "storage",
      receiveDriverStatus
    );

    return () => {
      window.removeEventListener(
        "storage",
        receiveDriverStatus
      );
    };
  }, [
    selectedVehicle.id,
  ]);

  // ==========================================================
  // RECEIVE LOCAL STORAGE INCIDENT
  // ==========================================================

  useEffect(() => {
    const receiveIncident =
      (event) => {
        if (
          event.key !==
          "guardianTransitIncident"
        ) {
          return;
        }

        if (!event.newValue) {
          return;
        }

        try {
          const data =
            JSON.parse(
              event.newValue
            );

          if (
            !data ||
            !data.event
          ) {
            return;
          }

          const vehicleId =
            data.vehicle ||
            "BUS-101";

          const driver =
            data.driver ||
            "Driver A";

          let risk = 15;

          let severity =
            data.severity ||
            "warning";

          if (
            data.event ===
            "MICRO-SLEEP DETECTED"
          ) {
            risk = 92;
            severity = "critical";
          } else if (
            data.event ===
            "EYES CLOSED"
          ) {
            risk = 55;
            severity = "warning";
          } else if (
            data.event ===
            "YAWN DETECTED"
          ) {
            risk = 65;
            severity = "warning";
          } else if (
            data.event ===
            "FACE NOT DETECTED"
          ) {
            risk = 35;
            severity = "warning";
          }

          recordRisk(
            vehicleId,
            risk
          );

          const newIncident = {
            id:
              Date.now() +
              Math.random(),

            type: data.event,

            vehicle: vehicleId,

            driver,

            severity,

            time: "Just now",
          };

          setIncidents((current) => [
            newIncident,
            ...current,
          ]);

          if (
            data.event ===
            "MICRO-SLEEP DETECTED"
          ) {
            setEvidenceVisible(
              true
            );

            setEvidenceData({
              event: data.event,
              vehicle: vehicleId,
              driver,
              severity: "critical",
              risk: 92,
              timestamp:
                new Date().toLocaleString(),
            });

            window.setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("CAPTURE_DRIVER_EVIDENCE")
              );
            }, 1200);
          }

          setVehicles(
            (current) =>
              current.map(
                (vehicle) => {
                  if (
                    vehicle.id !==
                    vehicleId
                  ) {
                    return vehicle;
                  }

                  const updated = {
                    ...vehicle,
                    status:
                      getStatusFromRisk(
                        risk
                      ),
                    risk,
                    driver,
                  };

                  if (
                    selectedVehicle.id ===
                    vehicle.id
                  ) {
                    setSelectedVehicle(
                      updated
                    );
                  }

                  return updated;
                }
              )
          );
        } catch (error) {
          console.error(
            "Incident data error:",
            error
          );
        }
      };

    window.addEventListener(
      "storage",
      receiveIncident
    );

    return () => {
      window.removeEventListener(
        "storage",
        receiveIncident
      );
    };
  }, [
    selectedVehicle.id,
  ]);

  // ==========================================================
  // RECEIVE DRIVER EVIDENCE CAPTURE
  // ==========================================================

  useEffect(() => {
    const handleEvidenceCaptured = (event) => {
      const data = event.detail;

      if (!data || !data.image) {
        return;
      }

      setCapturedEvidence(data);
      setEvidenceVisible(true);

      setEvidenceData((current) => ({
        ...(current || {}),
        vehicle: data.vehicle || selectedVehicle.id,
        timestamp: new Date(data.timestamp || Date.now()).toLocaleString(),
      }));

      recordAudit("DRIVER EVIDENCE CAPTURED", data.vehicle || selectedVehicle.id);
      addNotification(
        "EVIDENCE CAPTURED",
        `Driver camera snapshot captured for ${data.vehicle || selectedVehicle.id}`,
        "info"
      );
    };

    const handleEvidenceFailed = (event) => {
      const reason = event.detail?.reason || "UNKNOWN";
      recordAudit("EVIDENCE CAPTURE FAILED", event.detail?.vehicle || selectedVehicle.id);
      addNotification(
        "EVIDENCE CAPTURE FAILED",
        `${event.detail?.vehicle || selectedVehicle.id}: ${reason}`,
        "warning"
      );
    };

    window.addEventListener("DRIVER_EVIDENCE_CAPTURED", handleEvidenceCaptured);
    window.addEventListener("DRIVER_EVIDENCE_CAPTURE_FAILED", handleEvidenceFailed);

    return () => {
      window.removeEventListener("DRIVER_EVIDENCE_CAPTURED", handleEvidenceCaptured);
      window.removeEventListener("DRIVER_EVIDENCE_CAPTURE_FAILED", handleEvidenceFailed);
    };
  }, [selectedVehicle.id]);

  // ==========================================================
  // AUTOMATIC SIMULATION
  // ==========================================================

  useEffect(() => {
    if (
      !simulationRunning
    ) {
      return;
    }

    const interval =
      window.setInterval(() => {
        setVehicles(
          (currentVehicles) =>
            currentVehicles.map(
              (vehicle) => {
                const change =
                  Math.floor(
                    Math.random() *
                      21
                  ) - 10;

                const newRisk =
                  clamp(
                    vehicle.risk +
                      change,
                    5,
                    99
                  );

                recordRisk(
                  vehicle.id,
                  newRisk
                );

                return {
                  ...vehicle,
                  risk: newRisk,
                  status:
                    getStatusFromRisk(
                      newRisk
                    ),
                };
              }
            )
        );
      }, 5000);

    return () =>
      window.clearInterval(
        interval
      );
  }, [
    simulationRunning,
  ]);

  // ==========================================================
  // PREDICTIVE AI
  // ==========================================================

  const predictions = useMemo(() => {
    return vehicles.map(
      (vehicle) => ({
        vehicle,
        prediction:
          getPrediction(
            vehicle,
            riskHistory[
              vehicle.id
            ] || []
          ),
      })
    );
  }, [
    vehicles,
    riskHistory,
  ]);

  // ==========================================================
  // AUTOMATIC PREDICTIVE ALERTS
  // ==========================================================

  useEffect(() => {
    predictions.forEach(
      ({
        vehicle,
        prediction,
      }) => {
        const predictedRisk =
          prediction.predictedRisk;

        const shouldWarn =
          predictedRisk >= 50 &&
          predictedRisk < 80 &&
          vehicle.risk < 50;

        const shouldCritical =
          predictedRisk >= 80 &&
          vehicle.risk < 80;

        if (
          shouldCritical
        ) {
          const key = `${vehicle.id}-critical`;

          if (
            !predictionAlerts.current.has(
              key
            )
          ) {
            predictionAlerts.current.add(
              key
            );

            playAlertSound(
              "critical"
            );

            addNotification(
              "PREDICTIVE CRITICAL ALERT",
              `${vehicle.id} may reach ${predictedRisk}% risk`,
              "critical"
            );

            setIncidents(
              (current) => [
                {
                  id:
                    Date.now() +
                    Math.random(),
                  type:
                    "PREDICTIVE CRITICAL RISK",
                  vehicle:
                    vehicle.id,
                  driver:
                    vehicle.driver,
                  severity:
                    "critical",
                  time: "Just now",
                },
                ...current,
              ]
            );

            showMessage(
              `🚨 AI predicts ${vehicle.id} may reach critical risk`,
              6000
            );
          }
        } else if (
          shouldWarn
        ) {
          const key = `${vehicle.id}-warning`;

          if (
            !predictionAlerts.current.has(
              key
            )
          ) {
            predictionAlerts.current.add(
              key
            );

            playAlertSound(
              "warning"
            );

            addNotification(
              "PREDICTIVE WARNING",
              `${vehicle.id} may reach ${predictedRisk}% risk`,
              "warning"
            );

            setIncidents(
              (current) => [
                {
                  id:
                    Date.now() +
                    Math.random(),
                  type:
                    "PREDICTIVE WARNING",
                  vehicle:
                    vehicle.id,
                  driver:
                    vehicle.driver,
                  severity:
                    "warning",
                  time: "Just now",
                },
                ...current,
              ]
            );
          }
        }

        if (
          predictedRisk < 50
        ) {
          predictionAlerts.current.delete(
            `${vehicle.id}-warning`
          );

          predictionAlerts.current.delete(
            `${vehicle.id}-critical`
          );
        }
      }
    );
  }, [
    predictions,
  ]);

  // ==========================================================
  // AUTOMATIC CRITICAL RESPONSE
  // ==========================================================

  const triggerAutomaticCriticalResponse =
    (vehicle) => {
      if (!vehicle) {
        return;
      }

      if (
        criticalProcessedVehicles.current.has(
          vehicle.id
        )
      ) {
        return;
      }

      criticalProcessedVehicles.current.add(
        vehicle.id
      );

      playAlertSound(
        "critical"
      );

      // Send cabin audio warning
      sendDriverCommand(
        "AUDIO_ALERT",
        vehicle.id
      );

      // Flag vehicle for replacement
      sendDriverCommand(
        "REPLACE_VEHICLE",
        vehicle.id
      );

      // Update replacement status
      setVehicles(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              vehicle.id
                ? {
                    ...item,
                    status:
                      "CRITICAL",
                    risk: Math.max(
                      item.risk,
                      80
                    ),
                    replacementStatus:
                      "REPLACEMENT REQUIRED",
                  }
                : item
          )
      );

      setSelectedVehicle(
        (current) =>
          current.id ===
          vehicle.id
            ? {
                ...current,
                status:
                  "CRITICAL",
                risk: Math.max(
                  current.risk,
                  80
                ),
                replacementStatus:
                  "REPLACEMENT REQUIRED",
              }
            : current
      );

      // Incident log
      setIncidents(
        (current) => [
          {
            id:
              Date.now() +
              Math.random(),
            type:
              "AUTOMATIC REPLACEMENT REQUIRED",
            vehicle:
              vehicle.id,
            driver:
              vehicle.driver,
            severity:
              "critical",
            time: "Just now",
          },
          ...current,
        ]
      );

      // Evidence metadata
      setEvidenceData({
        event:
          "AUTOMATIC CRITICAL RISK DETECTED",

        vehicle:
          vehicle.id,

        driver:
          vehicle.driver,

        severity:
          "critical",

        risk:
          vehicle.risk,

        timestamp:
          new Date().toLocaleString(),
      });

      setEvidenceVisible(
        true
      );

      // Notification
      addNotification(
        "AUTOMATIC REPLACEMENT",
        `${vehicle.id} requires immediate replacement`,
        "critical"
      );

      recordAudit("AUTOMATIC REPLACEMENT REQUIRED", vehicle.id);

      showMessage(
        `🚨 ${vehicle.id}: AUTOMATIC REPLACEMENT REQUIRED`,
        7000
      );

      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("CAPTURE_DRIVER_EVIDENCE")
        );
      }, 1200);
    };

  // ==========================================================
  // WATCH FOR CRITICAL VEHICLES
  // ==========================================================

  useEffect(() => {
    vehicles.forEach(
      (vehicle) => {
        if (
          vehicle.risk >= 80 &&
          vehicle.status ===
            "CRITICAL"
        ) {
          triggerAutomaticCriticalResponse(
            vehicle
          );
        }

        if (
          vehicle.risk < 80
        ) {
          criticalProcessedVehicles.current.delete(
            vehicle.id
          );
        }
      }
    );
  }, [vehicles]);

  // ==========================================================
  // SEND AUDIO ALERT
  // ==========================================================

  const sendAlert = () => {
    const vehicle =
      selectedVehicle.id;

    const sent =
      sendDriverCommand(
        "AUDIO_ALERT",
        vehicle
      );

    if (sent) {
      playAlertSound(
        "warning"
      );

      addNotification(
        "AUDIO ALERT SENT",
        `Warning sent to ${vehicle}`,
        "warning"
      );

      recordAudit("AUDIO ALERT SENT", vehicle);

      showMessage(
        `🔊 Audio alert sent to ${vehicle}`
      );
    } else {
      showMessage(
        "⚠️ Driver connection not ready"
      );
    }
  };

  // ==========================================================
  // MANUAL REPLACEMENT
  // ==========================================================

  const flagVehicle = () => {
    const vehicle =
      selectedVehicle.id;

    const sent =
      sendDriverCommand(
        "REPLACE_VEHICLE",
        vehicle
      );

    if (sent) {
      playAlertSound(
        "critical"
      );

      setVehicles(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              vehicle
                ? {
                    ...item,
                    replacementStatus:
                      "REPLACEMENT REQUIRED",
                  }
                : item
          )
      );

      setIncidents(
        (current) => [
          {
            id:
              Date.now() +
              Math.random(),
            type:
              "VEHICLE FLAGGED FOR REPLACEMENT",
            vehicle,
            driver:
              selectedVehicle.driver,
            severity:
              "critical",
            time: "Just now",
          },
          ...current,
        ]
      );

      addNotification(
        "VEHICLE REPLACEMENT",
        `${vehicle} flagged for immediate replacement`,
        "critical"
      );

      recordAudit("VEHICLE FLAGGED FOR REPLACEMENT", vehicle);

      showMessage(
        `🚨 ${vehicle} flagged for immediate replacement`,
        5000
      );
    } else {
      showMessage(
        "⚠️ Driver connection not ready"
      );
    }
  };

  // ==========================================================
  // SIMULATE RISK
  // ==========================================================

  const simulateRisk = () => {
    const newRisk =
      Math.floor(
        Math.random() * 100
      );

    const newStatus =
      getStatusFromRisk(
        newRisk
      );

    const updatedVehicle = {
      ...selectedVehicle,
      risk: newRisk,
      status: newStatus,
    };

    recordRisk(
      selectedVehicle.id,
      newRisk
    );

    setVehicles(
      (current) =>
        current.map(
          (vehicle) =>
            vehicle.id ===
            selectedVehicle.id
              ? updatedVehicle
              : vehicle
        )
    );

    setSelectedVehicle(
      updatedVehicle
    );

    if (
      newRisk >= 80
    ) {
      playAlertSound(
        "critical"
      );
    } else if (
      newRisk >= 50
    ) {
      playAlertSound(
        "warning"
      );
    }
  };

  // ==========================================================
  // SIMULATE DRIVER INCIDENT
  // ==========================================================

  const simulateIncident = () => {
    const incidentData = {
      event:
        "MICRO-SLEEP DETECTED",

      vehicle:
        selectedVehicle.id,

      driver:
        selectedVehicle.driver,

      severity:
        "critical",

      time: Date.now(),
    };

    localStorage.setItem(
      "guardianTransitIncident",
      JSON.stringify(
        incidentData
      )
    );

    const now =
      new Date();

    const newIncident = {
      id:
        Date.now() +
        Math.random(),

      type:
        incidentData.event,

      vehicle:
        incidentData.vehicle,

      driver:
        incidentData.driver,

      severity:
        "critical",

      time: "Just now",
    };

    setIncidents(
      (current) => [
        newIncident,
        ...current,
      ]
    );

    recordRisk(
      selectedVehicle.id,
      92
    );

    const updatedVehicle = {
      ...selectedVehicle,
      status: "CRITICAL",
      risk: 92,
    };

    setVehicles(
      (current) =>
        current.map(
          (vehicle) =>
            vehicle.id ===
            selectedVehicle.id
              ? updatedVehicle
              : vehicle
        )
    );

    setSelectedVehicle(
      updatedVehicle
    );

    setEvidenceData({
      event:
        incidentData.event,

      vehicle:
        incidentData.vehicle,

      driver:
        incidentData.driver,

      severity:
        "critical",

      risk: 92,

      timestamp:
        now.toLocaleString(),
    });

    setEvidenceVisible(
      true
    );

    playAlertSound(
      "critical"
    );

    addNotification(
      "CRITICAL DRIVER INCIDENT",
      `${selectedVehicle.id}: micro-sleep detected`,
      "critical"
    );

    recordAudit("SIMULATED DRIVER INCIDENT", selectedVehicle.id);

    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("CAPTURE_DRIVER_EVIDENCE")
      );
    }, 1200);
  };

  // ==========================================================
  // COUNTERS
  // ==========================================================

  const activeCount =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "ACTIVE"
    ).length;

  const warningCount =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "WARNING"
    ).length;

  const criticalCount =
    vehicles.filter(
      (vehicle) =>
        vehicle.status ===
        "CRITICAL"
    ).length;

  // ==========================================================
  // ANALYTICS
  // ==========================================================

  const averageFleetRisk =
    vehicles.length
      ? Math.round(
          vehicles.reduce(
            (sum, vehicle) =>
              sum +
              vehicle.risk,
            0
          ) /
            vehicles.length
        )
      : 0;

  const fleetSafetyScore =
    getSafetyScore(
      averageFleetRisk
    );

  const activePercentage =
    vehicles.length
      ? Math.round(
          (activeCount /
            vehicles.length) *
            100
        )
      : 0;

  const warningPercentage =
    vehicles.length
      ? Math.round(
          (warningCount /
            vehicles.length) *
            100
        )
      : 0;

  const criticalPercentage =
    vehicles.length
      ? Math.round(
          (criticalCount /
            vehicles.length) *
            100
        )
      : 0;

  // ==========================================================
  // DRIVER PERFORMANCE
  // ==========================================================

  const driverPerformance =
    useMemo(() => {
      return vehicles.map(
        (vehicle) => {
          const driverIncidents =
            incidents.filter(
              (incident) =>
                incident.driver ===
                vehicle.driver
            );

          const microSleepCount =
            driverIncidents.filter(
              (incident) =>
                incident.type
                  .toUpperCase()
                  .includes(
                    "MICRO-SLEEP"
                  )
            ).length;

          const eyeClosureCount =
            driverIncidents.filter(
              (incident) =>
                incident.type
                  .toUpperCase()
                  .includes(
                    "EYE"
                  )
            ).length;

          const yawnCount =
            driverIncidents.filter(
              (incident) =>
                incident.type
                  .toUpperCase()
                  .includes(
                    "YAWN"
                  )
            ).length;

          const criticalEvents =
            driverIncidents.filter(
              (incident) =>
                incident.severity ===
                "critical"
            ).length;

          const history =
            riskHistory[
              vehicle.id
            ] || [];

          const trend =
            getTrend(
              history
            );

          const safetyScore =
            getSafetyScore(
              vehicle.risk
            );

          return {
            ...vehicle,
            safetyScore,
            safetyLabel:
              getSafetyLabel(
                safetyScore
              ),
            microSleepCount,
            eyeClosureCount,
            yawnCount,
            criticalEvents,
            trend,
          };
        }
      );
    }, [
      vehicles,
      incidents,
      riskHistory,
    ]);

  const selectedDriverPerformance =
    driverPerformance.find(
      (driver) =>
        driver.id ===
        selectedVehicle.id
    ) ||
    driverPerformance[0];

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="fleet-dashboard">

      {/* ====================================================
          REAL-TIME TELEMETRY
      ==================================================== */}

      <FleetTelemetry
        onTelemetry={
          receiveTelemetry
        }
      />

      {/* ====================================================
          LIVE NOTIFICATIONS
      ==================================================== */}

      <div className="notification-stack">

        {notifications.map(
          (notification) => (
            <div
              key={
                notification.id
              }
              className={`live-notification ${notification.type}`}
            >

              <div className="notification-icon">
                {notification.type ===
                "critical"
                  ? "🚨"
                  : notification.type ===
                    "warning"
                  ? "⚠️"
                  : "📡"}
              </div>

              <div className="notification-content">

                <strong>
                  {
                    notification.title
                  }
                </strong>

                <span>
                  {
                    notification.text
                  }
                </span>

                <small>
                  {
                    notification.time
                  }
                </small>

              </div>

            </div>
          )
        )}

      </div>

      {/* ====================================================
          HEADER
      ==================================================== */}

      <header className="fleet-header">

        <div>

          <h1>
            GUARDIANTRANSIT
          </h1>

          <p>
            Fleet Command Center
          </p>

        </div>

        <div className="system-status">

          <span className="status-dot"></span>

          SYSTEM ONLINE

        </div>

      </header>

      {/* ====================================================
          MESSAGE
      ==================================================== */}

      {message && (
        <div className="fleet-message">
          {message}
        </div>
      )}

      {/* ====================================================
          STATS
      ==================================================== */}

      <section className="fleet-stats">

        <div className="stat-card">

          <span>
            ACTIVE VEHICLES
          </span>

          <strong>
            {activeCount}
          </strong>

        </div>

        <div className="stat-card warning-stat">

          <span>
            WARNING
          </span>

          <strong>
            {warningCount}
          </strong>

        </div>

        <div className="stat-card critical-stat">

          <span>
            CRITICAL
          </span>

          <strong>
            {criticalCount}
          </strong>

        </div>

        <div className="stat-card">

          <span>
            TOTAL FLEET
          </span>

          <strong>
            {vehicles.length}
          </strong>

        </div>

      </section>

      {/* ====================================================
          FLEET ANALYTICS
      ==================================================== */}

      <section className="analytics-section">

        <div className="analytics-header">

          <div>
            <h2>
              Live Fleet Analytics
            </h2>

            <p>
              Real-time fleet safety
              overview
            </p>
          </div>

          <span className="analytics-live">
            ● LIVE
          </span>

        </div>

        <div className="analytics-grid">

          <div className="analytics-card">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                🛡️
              </span>

              <span>
                AVG RISK
              </span>
            </div>

            <strong className="analytics-number">
              {averageFleetRisk}%
            </strong>

            <small>
              Fleet average risk
            </small>

          </div>

          <div className="analytics-card active">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                🚌
              </span>

              <span>
                ACTIVE
              </span>
            </div>

            <strong className="analytics-number">
              {activePercentage}%
            </strong>

            <small>
              Fleet operating normally
            </small>

          </div>

          <div className="analytics-card warning">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                ⚠️
              </span>

              <span>
                WARNING
              </span>
            </div>

            <strong className="analytics-number">
              {warningPercentage}%
            </strong>

            <small>
              Vehicles requiring attention
            </small>

          </div>

          <div className="analytics-card">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                📋
              </span>

              <span>
                INCIDENTS
              </span>
            </div>

            <strong className="analytics-number">
              {incidents.length}
            </strong>

            <small>
              Total recorded incidents
            </small>

          </div>

          <div className="analytics-card">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                🚨
              </span>

              <span>
                CRITICAL EVENTS
              </span>
            </div>

            <strong className="analytics-number">
              {incidents.filter((incident) => incident.severity === "critical").length}
            </strong>

            <small>
              Critical safety incidents
            </small>

          </div>

          <div className="analytics-card">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                🛡️
              </span>

              <span>
                SAFETY SCORE
              </span>
            </div>

            <strong className="analytics-number">
              {fleetSafetyScore}/100
            </strong>

            <small>
              Current fleet safety score
            </small>

          </div>

          <div className="analytics-card critical">

            <div className="analytics-card-top">
              <span className="analytics-icon">
                🚨
              </span>

              <span>
                CRITICAL
              </span>
            </div>

            <strong className="analytics-number">
              {criticalPercentage}%
            </strong>

            <small>
              Vehicles at critical risk
            </small>

          </div>

        </div>

        <div className="analytics-distribution">

          <div className="distribution-header">

            <strong>
              Fleet Safety Distribution
            </strong>

            <span>
              Safety Score:{" "}
              {fleetSafetyScore}/100
            </span>

          </div>

          <div className="distribution-bar">

            <div
              className="distribution-active"
              style={{
                width: `${activePercentage}%`,
              }}
            ></div>

            <div
              className="distribution-warning"
              style={{
                width: `${warningPercentage}%`,
              }}
            ></div>

            <div
              className="distribution-critical"
              style={{
                width: `${criticalPercentage}%`,
              }}
            ></div>

          </div>

          <div className="distribution-legend">

            <span>
              <i className="legend-dot active"></i>
              Active {activeCount}
            </span>

            <span>
              <i className="legend-dot warning"></i>
              Warning {warningCount}
            </span>

            <span>
              <i className="legend-dot critical"></i>
              Critical {criticalCount}
            </span>

          </div>

        </div>

      </section>

      {/* ====================================================
          PREDICTIVE AI
      ==================================================== */}

      <section className="fleet-panel predictive-panel">

        <div className="panel-header">

          <div>

            <h2>
              🤖 Predictive AI Risk
              Forecast
            </h2>

            <p>
              AI-powered 5-minute
              risk prediction
            </p>

          </div>

          <span className="live-badge">
            AI LIVE
          </span>

        </div>

        {/* SIMULATION CONTROLS */}

        <div className="simulation-controls">

          <button
            className={
              simulationRunning
                ? "simulation-button stop"
                : "simulation-button start"
            }
            onClick={() =>
              setSimulationRunning(
                !simulationRunning
              )
            }
          >
            {simulationRunning
              ? "⏸ Stop Simulation"
              : "▶ Start Simulation"}
          </button>

          <span
            className={
              simulationRunning
                ? "simulation-status running"
                : "simulation-status stopped"
            }
          >
            {simulationRunning
              ? "● SIMULATION RUNNING"
              : "● SIMULATION STOPPED"}
          </span>

        </div>

        <div className="prediction-grid">

          {predictions.map(
            ({
              vehicle,
              prediction,
            }) => (
              <div
                key={
                  vehicle.id
                }
                className={`prediction-card ${
                  prediction.level.toLowerCase()
                }`}
              >

                <div className="prediction-card-top">

                  <strong>
                    🚌 {vehicle.id}
                  </strong>

                  <span
                    className={`vehicle-status ${prediction.level.toLowerCase()}`}
                  >
                    {
                      prediction.level
                    }
                  </span>

                </div>

                <div className="prediction-main">

                  <div>

                    <span>
                      CURRENT
                    </span>

                    <strong>
                      {vehicle.risk}%
                    </strong>

                  </div>

                  <div className="prediction-arrow">
                    →
                  </div>

                  <div>

                    <span>
                      PREDICTED
                    </span>

                    <strong>
                      {
                        prediction.predictedRisk
                      }%
                    </strong>

                  </div>

                </div>

                <div className="prediction-trend">

                  <span>
                    TREND
                  </span>

                  <strong>
                    {prediction.trend ===
                    "RISING"
                      ? "📈 RISING"
                      : prediction.trend ===
                        "IMPROVING"
                      ? "📉 IMPROVING"
                      : "➡️ STABLE"}
                  </strong>

                </div>

                <small>
                  {
                    prediction.forecast
                  }
                </small>

              </div>
            )
          )}

        </div>

      </section>

      {/* ====================================================
          DRIVER PERFORMANCE DASHBOARD
      ==================================================== */}

      <section className="driver-performance-section">

        <div className="analytics-header">

          <div>

            <h2>
              👤 Driver Performance
              Dashboard
            </h2>

            <p>
              AI-based driver safety
              and fatigue monitoring
            </p>

          </div>

          <span className="analytics-live">
            ● AI ANALYSIS
          </span>

        </div>

        {/* DRIVER CARDS */}

        <div className="driver-performance-grid">

          {driverPerformance.map(
            (driver) => (
              <button
                key={driver.id}
                className={`driver-performance-card ${
                  selectedVehicle.id ===
                  driver.id
                    ? "selected"
                    : ""
                }`}
                onClick={() =>
                  setSelectedVehicle(
                    driver
                  )
                }
              >

                <div className="driver-card-header">

                  <div>

                    <strong>
                      👤{" "}
                      {
                        driver.driver
                      }
                    </strong>

                    <span>
                      {driver.id}
                    </span>

                  </div>

                  <span
                    className={`vehicle-status ${driver.status.toLowerCase()}`}
                  >
                    {
                      driver.status
                    }
                  </span>

                </div>

                <div className="driver-score">

                  <div>

                    <span>
                      SAFETY SCORE
                    </span>

                    <strong>
                      {
                        driver.safetyScore
                      }
                      /100
                    </strong>

                  </div>

                  <span>
                    {
                      driver.safetyLabel
                    }
                  </span>

                </div>

                <div className="driver-score-bar">

                  <div
                    style={{
                      width: `${driver.safetyScore}%`,
                    }}
                  ></div>

                </div>

                <div className="driver-metrics">

                  <div>

                    <span>
                      😴
                    </span>

                    <strong>
                      {
                        driver.microSleepCount
                      }
                    </strong>

                    <small>
                      Micro-sleep
                    </small>

                  </div>

                  <div>

                    <span>
                      👁️
                    </span>

                    <strong>
                      {
                        driver.eyeClosureCount
                      }
                    </strong>

                    <small>
                      Eye closure
                    </small>

                  </div>

                  <div>

                    <span>
                      🥱
                    </span>

                    <strong>
                      {
                        driver.yawnCount
                      }
                    </strong>

                    <small>
                      Yawns
                    </small>

                  </div>

                  <div>

                    <span>
                      🚨
                    </span>

                    <strong>
                      {
                        driver.criticalEvents
                      }
                    </strong>

                    <small>
                      Critical
                    </small>

                  </div>

                </div>

                <div className="driver-trend">

                  <span>
                    RISK TREND
                  </span>

                  <strong>
                    {driver.trend ===
                    "RISING"
                      ? "📈 RISING"
                      : driver.trend ===
                        "IMPROVING"
                      ? "📉 IMPROVING"
                      : "➡️ STABLE"}
                  </strong>

                </div>

              </button>
            )
          )}

        </div>

        {/* SELECTED DRIVER DETAIL */}

        {selectedDriverPerformance && (
          <div className="selected-driver-performance">

            <div className="selected-driver-header">

              <div>

                <span>
                  SELECTED DRIVER
                </span>

                <h3>
                  👤{" "}
                  {
                    selectedDriverPerformance.driver
                  }
                </h3>

              </div>

              <div className="selected-driver-score">

                <span>
                  AI SAFETY SCORE
                </span>

                <strong>
                  {
                    selectedDriverPerformance.safetyScore
                  }
                  /100
                </strong>

              </div>

            </div>

            <div className="selected-driver-metrics">

              <div>

                <span>
                  VEHICLE
                </span>

                <strong>
                  {
                    selectedDriverPerformance.id
                  }
                </strong>

              </div>

              <div>

                <span>
                  CURRENT RISK
                </span>

                <strong>
                  {
                    selectedDriverPerformance.risk
                  }%
                </strong>

              </div>

              <div>

                <span>
                  FATIGUE EVENTS
                </span>

                <strong>
                  {
                    selectedDriverPerformance
                      .microSleepCount +
                    selectedDriverPerformance
                      .eyeClosureCount +
                    selectedDriverPerformance
                      .yawnCount
                  }
                </strong>

              </div>

              <div>

                <span>
                  CRITICAL EVENTS
                </span>

                <strong>
                  {
                    selectedDriverPerformance
                      .criticalEvents
                  }
                </strong>

              </div>

              <div>

                <span>
                  TREND
                </span>

                <strong>
                  {
                    selectedDriverPerformance
                      .trend
                  }
                </strong>

              </div>

            </div>

            {/* RISK HISTORY */}

            <div className="driver-risk-history">

              <div className="history-header">

                <strong>
                  Risk History
                </strong>

                <span>
                  Last readings
                </span>

              </div>

              <div className="history-chart">

                {(riskHistory[
                  selectedDriverPerformance
                    .id
                ] || []
                ).map(
                  (
                    risk,
                    index
                  ) => (
                    <div
                      className="history-bar-wrapper"
                      key={`${selectedDriverPerformance.id}-${index}`}
                    >

                      <div
                        className={`history-bar ${
                          risk >= 80
                            ? "critical"
                            : risk >= 50
                            ? "warning"
                            : "active"
                        }`}
                        style={{
                          height: `${Math.max(
                            risk,
                            8
                          )}%`,
                        }}
                        title={`${risk}% risk`}
                      >
                        <span>
                          {risk}
                        </span>
                      </div>

                      <small>
                        {index + 1}
                      </small>

                    </div>
                  )
                )}

              </div>

              <div className="history-thresholds">

                <span>
                  <i className="legend-dot active"></i>
                  Safe
                </span>

                <span>
                  <i className="legend-dot warning"></i>
                  Warning
                </span>

                <span>
                  <i className="legend-dot critical"></i>
                  Critical
                </span>

              </div>

            </div>

          </div>
        )}

      </section>

      {/* ====================================================
          MAIN VEHICLE GRID
      ==================================================== */}

      <div className="fleet-main-grid">

        {/* VEHICLES */}

        <section className="fleet-panel">

          <div className="panel-header">

            <div>

              <h2>
                Fleet Vehicles
              </h2>

              <p>
                Real-time safety
                monitoring
              </p>

            </div>

            <span className="live-badge">
              LIVE
            </span>

          </div>

          <div className="vehicle-list">

            {vehicles.map(
              (vehicle) => (
                <button
                  key={vehicle.id}
                  className={`vehicle-card ${
                    selectedVehicle.id ===
                    vehicle.id
                      ? "selected"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedVehicle(
                      vehicle
                    )
                  }
                >

                  <div className="vehicle-top">

                    <div>

                      <strong>
                        🚌{" "}
                        {vehicle.id}
                      </strong>

                      <span>
                        {
                          vehicle.driver
                        }
                      </span>

                    </div>

                    <span
                      className={`vehicle-status ${vehicle.status.toLowerCase()}`}
                    >
                      {
                        vehicle.status
                      }
                    </span>

                  </div>

                  <div className="vehicle-location">

                    📍{" "}
                    {
                      vehicle.location
                    }

                  </div>

                  <div className="risk-row">

                    <span>
                      Risk Score
                    </span>

                    <strong>
                      {
                        vehicle.risk
                      }%
                    </strong>

                  </div>

                  <div className="risk-bar">

                    <div
                      style={{
                        width: `${vehicle.risk}%`,
                      }}
                    ></div>

                  </div>

                  {vehicle.replacementStatus ===
                    "REPLACEMENT REQUIRED" && (
                    <div className="replacement-required">
                      🚨 Replacement Required
                    </div>
                  )}

                </button>
              )
            )}

          </div>

        </section>

        {/* MAP */}

        <section className="fleet-panel map-panel">

          <div className="panel-header">

            <div>

              <h2>
                Live Fleet Map
              </h2>

              <p>
                Active vehicle
                locations
              </p>

            </div>

            <span className="live-badge">
              LIVE
            </span>

          </div>

         <FleetMap
            vehicles={vehicles}
            selectedVehicle={selectedVehicle}
            setSelectedVehicle={setSelectedVehicle}
        />

        </section>

      </div>

      {/* ====================================================
          SELECTED VEHICLE
      ==================================================== */}

      <section className="vehicle-detail-panel">

        <div className="detail-header">

          <div>

            <span className="detail-label">
              SELECTED VEHICLE
            </span>

            <h2>
              🚌{" "}
              {
                selectedVehicle.id
              }
            </h2>

          </div>

          <span
            className={`vehicle-status ${selectedVehicle.status.toLowerCase()}`}
          >
            {
              selectedVehicle.status
            }
          </span>

        </div>

        <div className="vehicle-detail-grid">

          <div className="detail-item">

            <span>
              DRIVER
            </span>

            <strong>
              {
                selectedVehicle.driver
              }
            </strong>

          </div>

          <div className="detail-item">

            <span>
              ROUTE
            </span>

            <strong>
              {
                selectedVehicle.route
              }
            </strong>

          </div>

          <div className="detail-item">

            <span>
              LOCATION
            </span>

            <strong>
              {
                selectedVehicle.location
              }
            </strong>

          </div>

          <div className="detail-item">

            <span>
              SPEED
            </span>

            <strong>
              {
                selectedVehicle.speed
              }{" "}
              km/h
            </strong>

          </div>

          <div className="detail-item">

            <span>
              RISK SCORE
            </span>

            <strong>
              {
                selectedVehicle.risk
              }%
            </strong>

          </div>

          <div className="detail-item">

            <span>
              REPLACEMENT
            </span>

            <strong>
              {
                selectedVehicle.replacementStatus ||
                "NORMAL"
              }
            </strong>

          </div>

        </div>

      </section>

      {/* ====================================================
          LIVE DRIVER AI STATUS
      ==================================================== */}

      <section className="fleet-panel live-driver-status">

        <div className="panel-header">

          <div>

            <h2>
              Live Driver AI Status
            </h2>

            <p>
              Real-time driver
              monitoring
            </p>

          </div>

          <span className="live-badge">
            AI LIVE
          </span>

        </div>

        <div className="ai-status-grid">

          <div className="ai-status-item">

            <span>
              DRIVER
            </span>

            <strong>
              {
                driverLiveStatus.driver
              }
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              VEHICLE
            </span>

            <strong>
              {
                driverLiveStatus.vehicle
              }
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              AI STATUS
            </span>

            <strong>
              {
                driverLiveStatus.status
              }
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              RISK
            </span>

            <strong>
              {
                driverLiveStatus.risk
              }%
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              EYES
            </span>

            <strong>
              {
                driverLiveStatus.eyeStatus ||
                "NORMAL"
              }
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              HEAD
            </span>

            <strong>
              {
                driverLiveStatus.headStatus ||
                "FOCUSED"
              }
            </strong>

          </div>

          <div className="ai-status-item">

            <span>
              YAWNS
            </span>

            <strong>
              {
                driverLiveStatus.yawns ??
                0
              }
            </strong>

          </div>

        </div>

      </section>

      {/* ====================================================
          REMOTE DRIVER CAMERA
      ==================================================== */}

      <section className="evidence-panel">

        <div className="panel-header">

          <div>

            <h2>
              Driver Camera
            </h2>

            <p>
              Real-time remote
              driver feed
            </p>

          </div>

        </div>

        <RemoteDriverCamera vehicleId={selectedVehicle.id} />

      </section>

      {/* ====================================================
          REMOTE INTERVENTION
      ==================================================== */}

      <section className="fleet-panel intervention-panel">

        <div className="panel-header">

          <div>

            <h2>
              Remote Intervention
            </h2>

            <p>
              Control selected
              vehicle
            </p>

          </div>

        </div>

        <div className="intervention-buttons">

          <button
            className="action-button audio-button"
            onClick={
              sendAlert
            }
          >
            🔊 Send Audio Alert
          </button>

          <button
            className="action-button replace-button"
            onClick={
              flagVehicle
            }
          >
            🚨 Flag for Replacement
          </button>

          <button
            className="action-button simulate-button"
            onClick={
              simulateRisk
            }
          >
            ⚡ Simulate Risk Change
          </button>

          <button
            className="action-button incident-button"
            onClick={
              simulateIncident
            }
          >
            🚨 Simulate Driver Incident
          </button>

        </div>

      </section>

      {/* ====================================================
          INCIDENT EVIDENCE
      ==================================================== */}

      {evidenceVisible && (
        <section className="evidence-panel critical-evidence-panel">

          <div className="panel-header">

            <div>

              <h2>
                🚨 Incident Evidence
              </h2>

              <p>
                Critical driver
                safety event
              </p>

            </div>

            <span className="critical-badge">
              CRITICAL
            </span>

          </div>

          {evidenceData && (
            <div className="incident-evidence-info">

              <div className="evidence-info-card">

                <span>
                  EVENT
                </span>

                <strong>
                  {
                    evidenceData.event
                  }
                </strong>

              </div>

              <div className="evidence-info-card">

                <span>
                  VEHICLE
                </span>

                <strong>
                  {
                    evidenceData.vehicle
                  }
                </strong>

              </div>

              <div className="evidence-info-card">

                <span>
                  DRIVER
                </span>

                <strong>
                  {
                    evidenceData.driver
                  }
                </strong>

              </div>

              <div className="evidence-info-card">

                <span>
                  RISK SCORE
                </span>

                <strong>
                  {
                    evidenceData.risk
                  }%
                </strong>

              </div>

              <div className="evidence-info-card">

                <span>
                  TIME
                </span>

                <strong>
                  {
                    evidenceData.timestamp
                  }
                </strong>

              </div>

            </div>
          )}

          <div className="driver-camera-info">

            <strong>
              🎥 Driver Camera
              Evidence
            </strong>

            <span>
              Live driver camera
              feed associated with
              this incident.
            </span>

          </div>

          {capturedEvidence?.image ? (
            <div style={{ marginTop: "14px" }}>
              <img
                src={capturedEvidence.image}
                alt="Captured driver evidence"
                style={{
                  width: "100%",
                  maxHeight: "300px",
                  objectFit: "contain",
                  display: "block",
                  background: "#0f172a",
                  borderRadius: "10px",
                  border: "1px solid #e5e7eb",
                }}
              />
              <div style={{ marginTop: "8px", fontSize: "11px", color: "#64748b" }}>
                📸 Snapshot captured {new Date(capturedEvidence.timestamp).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="driver-camera-info" style={{ marginTop: "12px" }}>
              <strong>Waiting for camera evidence…</strong>
              <span>The live Driver Camera above is used for incident snapshots.</span>
            </div>
          )}

          <button
            className="close-evidence-button"
            onClick={() =>
              setEvidenceVisible(
                false
              )
            }
          >
            Close Evidence
          </button>

        </section>
      )}

      {/* ====================================================
          INTERVENTION AUDIT LOG
      ==================================================== */}

      <section className="fleet-panel intervention-audit-panel">

        <div className="panel-header">
          <div>
            <h2>Intervention Audit Log</h2>
            <p>Recent fleet safety actions and evidence events</p>
          </div>
          <span className="live-badge">AUDIT</span>
        </div>

        <div className="incident-list">
          {interventionAudit.map((entry) => (
            <div className="incident-item info" key={entry.id}>
              <div className="incident-icon">📋</div>
              <div className="incident-content">
                <strong>{entry.action}</strong>
                <span>{entry.vehicle}</span>
              </div>
              <time>{entry.time}</time>
            </div>
          ))}
        </div>

      </section>

      {/* ====================================================
          INCIDENT LOG
      ==================================================== */}

      <section className="fleet-panel incident-panel">

        <div className="panel-header">

          <div>

            <h2>
              Live Incident Log
            </h2>

            <p>
              Timestamped driver
              safety events
            </p>

          </div>

          <span className="live-badge">
            LIVE
          </span>

        </div>

        <div className="incident-list">

          {incidents.map(
            (incident) => (
              <div
                className={`incident-item ${incident.severity}`}
                key={
                  incident.id
                }
              >

                <div className="incident-icon">

                  {incident.severity ===
                  "critical"
                    ? "🚨"
                    : incident.severity ===
                      "warning"
                    ? "⚠️"
                    : "ℹ️"}

                </div>

                <div className="incident-content">

                  <strong>
                    {
                      incident.type
                    }
                  </strong>

                  <span>
                    {
                      incident.vehicle
                    }{" "}
                    •{" "}
                    {
                      incident.driver
                    }
                  </span>

                </div>

                <time>
                  {
                    incident.time
                  }
                </time>

              </div>
            )
          )}

        </div>

      </section>

      {/* ====================================================
          FOOTER
      ==================================================== */}

      <footer className="fleet-footer">

        <span>
          GUARDIANTRANSIT
        </span>

        <span>
          AI-Powered Public
          Transport Safety
          System
        </span>

      </footer>

    </div>
  );
}

export default FleetDashboard;