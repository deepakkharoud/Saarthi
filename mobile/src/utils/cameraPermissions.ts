export type CameraPermissionState = "loading" | "granted" | "denied";

export interface CameraPermissionLike {
  granted?: boolean;
}

/**
 * Distinguish between permission-loading, permission-granted, and confirmed-denied states.
 * Crucial to prevent flashing "Camera Access Required" while the permission state is resolving.
 *
 * - null or undefined -> "loading" (async permission query still in-flight)
 * - granted: true     -> "granted"
 * - granted: false    -> "denied"
 */
export function resolveCameraPermissionState(
  permission: CameraPermissionLike | null | undefined
): CameraPermissionState {
  if (permission === null || permission === undefined) {
    return "loading";
  }
  return permission.granted ? "granted" : "denied";
}
