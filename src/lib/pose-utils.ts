// Pose landmark indices from MediaPipe
export const LANDMARK = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export interface Point3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

// Skeleton connections for drawing
export const POSE_CONNECTIONS: [number, number][] = [
  // Torso
  [LANDMARK.LEFT_SHOULDER, LANDMARK.RIGHT_SHOULDER],
  [LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_HIP],
  [LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_HIP],
  [LANDMARK.LEFT_HIP, LANDMARK.RIGHT_HIP],
  // Left arm
  [LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_ELBOW],
  [LANDMARK.LEFT_ELBOW, LANDMARK.LEFT_WRIST],
  // Right arm
  [LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_ELBOW],
  [LANDMARK.RIGHT_ELBOW, LANDMARK.RIGHT_WRIST],
  // Left leg
  [LANDMARK.LEFT_HIP, LANDMARK.LEFT_KNEE],
  [LANDMARK.LEFT_KNEE, LANDMARK.LEFT_ANKLE],
  // Right leg
  [LANDMARK.RIGHT_HIP, LANDMARK.RIGHT_KNEE],
  [LANDMARK.RIGHT_KNEE, LANDMARK.RIGHT_ANKLE],
  // Face
  [LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_EAR],
  [LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_EAR],
];

/**
 * Calculate angle between three points (in degrees)
 * The angle is measured at point B (the middle point)
 */
export function calculateAngle(a: Point3D, b: Point3D, c: Point3D): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return angle;
}

/**
 * Calculate distance between two points (2D)
 */
export function distance2D(a: Point3D, b: Point3D): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

/**
 * Calculate distance between two points (3D)
 */
export function distance3D(a: Point3D, b: Point3D): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2)
  );
}

/**
 * Get midpoint of two points
 */
export function midpoint(a: Point3D, b: Point3D): Point3D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

/**
 * Check if a landmark is visible enough to use
 */
export function isVisible(point: Point3D, threshold = 0.5): boolean {
  return (point.visibility ?? 0) >= threshold;
}

/**
 * Get the average Y position (normalized) - lower Y = higher on screen
 */
export function getBodyHeight(landmarks: Point3D[]): number {
  const hip = midpoint(landmarks[LANDMARK.LEFT_HIP], landmarks[LANDMARK.RIGHT_HIP]);
  const ankle = midpoint(landmarks[LANDMARK.LEFT_ANKLE], landmarks[LANDMARK.RIGHT_ANKLE]);
  return Math.abs(hip.y - ankle.y);
}

/**
 * Check if body is roughly horizontal (for push-ups, planks)
 */
export function isBodyHorizontal(landmarks: Point3D[]): boolean {
  const shoulder = midpoint(
    landmarks[LANDMARK.LEFT_SHOULDER],
    landmarks[LANDMARK.RIGHT_SHOULDER]
  );
  const hip = midpoint(landmarks[LANDMARK.LEFT_HIP], landmarks[LANDMARK.RIGHT_HIP]);
  const ankle = midpoint(landmarks[LANDMARK.LEFT_ANKLE], landmarks[LANDMARK.RIGHT_ANKLE]);

  const shoulderHipAngle = Math.abs(shoulder.y - hip.y);
  const hipAnkleAngle = Math.abs(hip.y - ankle.y);

  // Body is horizontal if shoulder-hip and hip-ankle are relatively level
  return shoulderHipAngle < 0.15 && hipAnkleAngle < 0.15;
}

/**
 * Check if person is standing upright
 */
export function isStanding(landmarks: Point3D[]): boolean {
  const shoulder = midpoint(
    landmarks[LANDMARK.LEFT_SHOULDER],
    landmarks[LANDMARK.RIGHT_SHOULDER]
  );
  const hip = midpoint(landmarks[LANDMARK.LEFT_HIP], landmarks[LANDMARK.RIGHT_HIP]);
  const ankle = midpoint(landmarks[LANDMARK.LEFT_ANKLE], landmarks[LANDMARK.RIGHT_ANKLE]);

  // Shoulders should be above hips, hips above ankles
  return shoulder.y < hip.y && hip.y < ankle.y;
}

/**
 * Smooth a value using exponential moving average
 */
export function smoothValue(
  current: number,
  previous: number,
  alpha = 0.3
): number {
  return alpha * current + (1 - alpha) * previous;
}
