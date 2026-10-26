import { describe, it, expect } from "@jest/globals";
import { resolveCameraPermissionState } from "../utils/cameraPermissions";

describe("Camera Permission State Resolution", () => {
  it("treats initial null permission as 'loading' rather than 'denied'", () => {
    // When useCameraPermissions() hook initially mounts, permission is null
    const state = resolveCameraPermissionState(null);
    expect(state).toBe("loading");
    expect(state).not.toBe("denied");
    expect(state).not.toBe("granted");
  });

  it("treats undefined permission as 'loading'", () => {
    const state = resolveCameraPermissionState(undefined);
    expect(state).toBe("loading");
    expect(state).not.toBe("denied");
  });

  it("treats granted permission as 'granted' directly", () => {
    const state = resolveCameraPermissionState({ granted: true });
    expect(state).toBe("granted");
    expect(state).not.toBe("loading");
    expect(state).not.toBe("denied");
  });

  it("treats confirmed non-granted permission as 'denied'", () => {
    const state = resolveCameraPermissionState({ granted: false });
    expect(state).toBe("denied");
    expect(state).not.toBe("loading");
    expect(state).not.toBe("granted");
  });

  it("ensures 'Camera Access Required' is prevented when state is loading or granted", () => {
    const shouldShowAccessRequiredUI = (
      permission: { granted?: boolean } | null | undefined
    ): boolean => {
      const state = resolveCameraPermissionState(permission);
      // ONLY show permission-required UI if confirmed denied
      return state === "denied";
    };

    // When permission is still loading from OS:
    expect(shouldShowAccessRequiredUI(null)).toBe(false);
    expect(shouldShowAccessRequiredUI(undefined)).toBe(false);

    // When permission was already granted:
    expect(shouldShowAccessRequiredUI({ granted: true })).toBe(false);

    // Only when user explicitly denied permission:
    expect(shouldShowAccessRequiredUI({ granted: false })).toBe(true);
  });
});
