import { useEffect, useRef, useState } from "react";

import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

function FaceMonitor({
  videoRef,
  cameraActive,
  onStatusChange,
}) {
  const landmarkerRef = useRef(null);
  const animationRef = useRef(null);

  const eyesClosedSinceRef = useRef(null);
  const lastMicroSleepRef = useRef(0);
  const mouthOpenSinceRef = useRef(null);
  const lastYawnRef = useRef(0);

  const onStatusChangeRef = useRef(onStatusChange);
  const lastReportedStatusRef = useRef("");

  const [faceDetected, setFaceDetected] = useState(false);
  const [eyeState, setEyeState] = useState("WAITING");
  const [expression, setExpression] = useState("WAITING");
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState(false);

  // ==========================================
  // CALLBACK
  // ==========================================

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const reportStatus = (status) => {
    if (status === lastReportedStatusRef.current) {
      return;
    }

    lastReportedStatusRef.current = status;

    if (typeof onStatusChangeRef.current === "function") {
      onStatusChangeRef.current(status);
    }
  };

  // ==========================================
  // LOAD MEDIAPIPE AI
  // ==========================================

  useEffect(() => {
    let cancelled = false;

    const loadModel = async () => {
      try {
        console.log("🤖 Loading MediaPipe AI...");

        setError("");
        setAiReady(false);

        // Load MediaPipe WASM
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        console.log("✅ MediaPipe WASM loaded");

        // Load Face Landmarker model
        const landmarker =
          await FaceLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              },

              runningMode: "VIDEO",

              numFaces: 1,

              minFaceDetectionConfidence: 0.3,

              minFacePresenceConfidence: 0.3,

              minTrackingConfidence: 0.3,

              outputFaceBlendshapes: true,
            }
          );

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;

        setAiReady(true);
        setError("");

        console.log("=================================");
        console.log("🤖 MEDIAPIPE AI READY");
        console.log("=================================");

        reportStatus("AI MODEL READY");

        setEyeState("NORMAL");
        setExpression("NEUTRAL");
      } catch (err) {
        console.error(
          "❌ MEDIAPIPE AI LOAD ERROR:",
          err
        );

        console.error(
          "Error message:",
          err?.message
        );

        setAiReady(false);

        setError(
          "AI model could not be loaded."
        );

        reportStatus("AI MODEL ERROR");
      }
    };

    loadModel();

    return () => {
      cancelled = true;

      if (animationRef.current) {
        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;
      }

      if (landmarkerRef.current) {
        landmarkerRef.current.close();

        landmarkerRef.current = null;
      }
    };
  }, []);

  // ==========================================
  // CAMERA + FACE DETECTION
  // ==========================================

  useEffect(() => {
    if (!cameraActive) {
      if (animationRef.current) {
        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;
      }

      setFaceDetected(false);
      setEyeState("WAITING");
      setExpression("WAITING");

      eyesClosedSinceRef.current = null;
      mouthOpenSinceRef.current = null;

      return;
    }

    let stopped = false;

    const detectFace = () => {
      if (stopped) {
        return;
      }

      const video = videoRef?.current;

      const landmarker =
        landmarkerRef.current;

      // ========================================
      // WAIT FOR MEDIAPIPE
      // ========================================

      if (!landmarker) {
        setFaceDetected(false);

        setEyeState("STARTING AI");

        setExpression(
          "WAITING FOR AI"
        );

        animationRef.current =
          requestAnimationFrame(
            detectFace
          );

        return;
      }

      // ========================================
      // WAIT FOR CAMERA
      // ========================================

      if (
        !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        setFaceDetected(false);

        setEyeState(
          "STARTING CAMERA"
        );

        setExpression(
          "WAITING FOR CAMERA"
        );

        animationRef.current =
          requestAnimationFrame(
            detectFace
          );

        return;
      }

      // ========================================
      // RUN AI
      // ========================================

      try {
        const result =
          landmarker.detectForVideo(
            video,
            performance.now()
          );

        const hasFace =
          result?.faceLandmarks?.length >
          0;

        // ======================================
        // FACE FOUND
        // ======================================

        if (hasFace) {
          setFaceDetected(true);

          analyzeFace(result);
        }

        // ======================================
        // FACE NOT FOUND
        // ======================================

        else {
          setFaceDetected(false);

          eyesClosedSinceRef.current =
            null;

          mouthOpenSinceRef.current =
            null;

          setEyeState("NO FACE");

          setExpression("NO FACE");

          reportStatus(
            "FACE NOT DETECTED"
          );
        }
      } catch (err) {
        console.error(
          "❌ Face detection error:",
          err
        );
      }

      animationRef.current =
        requestAnimationFrame(
          detectFace
        );
    };

    animationRef.current =
      requestAnimationFrame(
        detectFace
      );

    return () => {
      stopped = true;

      if (animationRef.current) {
        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;
      }
    };
  }, [
    cameraActive,
    videoRef,
    aiReady,
  ]);

  // ==========================================
  // ANALYZE FACE
  // ==========================================

  const analyzeFace = (result) => {
    const categories =
      result?.faceBlendshapes?.[0]
        ?.categories || [];

    // ========================================
    // EYE BLINK
    // ========================================

    const leftBlink =
      getBlendshapeScore(
        categories,
        "eyeBlinkLeft"
      );

    const rightBlink =
      getBlendshapeScore(
        categories,
        "eyeBlinkRight"
      );

    const averageBlink =
      (leftBlink + rightBlink) / 2;

    const eyesClosed =
      averageBlink >= 0.45;

    console.log(
      `👁️ L:${leftBlink.toFixed(
        2
      )} R:${rightBlink.toFixed(
        2
      )} AVG:${averageBlink.toFixed(
        2
      )} ${
        eyesClosed
          ? "CLOSED"
          : "OPEN"
      }`
    );

    // ========================================
    // EYE STATUS
    // ========================================

    if (eyesClosed) {
      handleEyesClosed();
    } else {
      handleEyesOpen();
    }

    // ========================================
    // MOUTH / YAWN
    // ========================================

    const mouthOpen =
      getBlendshapeScore(
        categories,
        "jawOpen"
      );

    const smileLeft =
      getBlendshapeScore(
        categories,
        "mouthSmileLeft"
      );

    const smileRight =
      getBlendshapeScore(
        categories,
        "mouthSmileRight"
      );

    const smile =
      smileLeft + smileRight;

    // ========================================
    // YAWN DETECTION
    // ========================================

    if (mouthOpen > 0.55) {
      setExpression("MOUTH OPEN");

      if (
        mouthOpenSinceRef.current ===
        null
      ) {
        mouthOpenSinceRef.current =
          Date.now();
      }

      const mouthTime =
        Date.now() -
        mouthOpenSinceRef.current;

      if (
        mouthTime >= 1000 &&
        Date.now() -
          lastYawnRef.current >
          5000
      ) {
        lastYawnRef.current =
          Date.now();

        console.log(
          "🥱 YAWN DETECTED"
        );

        reportStatus(
          "YAWN DETECTED"
        );
      }
    } else {
      mouthOpenSinceRef.current =
        null;

      if (smile > 0.8) {
        setExpression(
          "SMILING"
        );
      } else {
        setExpression(
          "NEUTRAL"
        );
      }
    }
  };

  // ==========================================
  // EYES CLOSED
  // ==========================================

  const handleEyesClosed = () => {
    setEyeState("CLOSED");

    // First moment eyes close
    if (
      eyesClosedSinceRef.current ===
      null
    ) {
      eyesClosedSinceRef.current =
        Date.now();

      console.log(
        "👁️ EYES CLOSED"
      );

      // Immediate warning
      reportStatus(
        "EYES CLOSED"
      );

      return;
    }

    const closedTime =
      Date.now() -
      eyesClosedSinceRef.current;

    console.log(
      "👁️ Eyes closed for:",
      closedTime,
      "ms"
    );

    // ========================================
    // MICRO SLEEP
    // ========================================

    if (closedTime >= 2500) {
      if (
        Date.now() -
          lastMicroSleepRef.current >
        3000
      ) {
        lastMicroSleepRef.current =
          Date.now();

        console.log(
          "🚨 MICRO-SLEEP DETECTED"
        );

        reportStatus(
          "MICRO-SLEEP DETECTED"
        );
      }
    } else {
      reportStatus(
        "EYES CLOSED"
      );
    }
  };

  // ==========================================
  // EYES OPEN
  // ==========================================

  const handleEyesOpen = () => {
    setEyeState("OPEN");

    const wasClosed =
      eyesClosedSinceRef.current !==
      null;

    eyesClosedSinceRef.current =
      null;

    if (wasClosed) {
      console.log(
        "👁️ Eyes opened"
      );
    }

    reportStatus(
      "DRIVER FOCUSED"
    );
  };

  // ==========================================
  // BLENDSHAPE HELPER
  // ==========================================

  const getBlendshapeScore = (
    categories,
    name
  ) => {
    const item =
      categories.find(
        (category) =>
          category.categoryName ===
          name
      );

    return item?.score || 0;
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="face-monitor">

      <div className="face-monitor-status">

        <div>
          <span
            className={
              faceDetected
                ? "face-dot active"
                : "face-dot"
            }
          />

          <strong>
            {!cameraActive
              ? "CAMERA OFF"
              : !aiReady
              ? "STARTING MEDIAPIPE AI"
              : faceDetected
              ? "FACE DETECTED"
              : "SEARCHING FOR FACE"}
          </strong>
        </div>

        <span className="ai-label">
          MEDIAPIPE AI
        </span>

      </div>

      <div className="face-results">

        <div className="face-result">

          <span>
            Eye Status
          </span>

          <strong>
            {eyeState}
          </strong>

        </div>

        <div className="face-result">

          <span>
            Expression
          </span>

          <strong>
            {expression}
          </strong>

        </div>

      </div>

      {error && (
        <div className="face-error">
          {error}
        </div>
      )}

    </div>
  );
}

export default FaceMonitor;