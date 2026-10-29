import { describe, it, expect, jest } from "@jest/globals";

// Mock native ESM modules so ts-jest (node environment) runs cleanly without requiring native Android/iOS ESM
jest.mock(
  "expo-speech",
  () => ({
    speak: jest.fn(),
    stop: jest.fn(),
    isSpeakingAsync: jest.fn(async () => false),
    getAvailableVoicesAsync: jest.fn(async () => []),
  }),
  { virtual: true }
);

jest.mock(
  "react-native",
  () => ({
    Platform: { OS: "android" },
  }),
  { virtual: true }
);

import { parseVoiceCommand } from "./voiceCommands";
import { dispatchVoiceCommand, VoiceCommandDispatchContext } from "./voiceDispatcher";

describe("Voice Commands & Dispatcher — Map Voice Navigation", () => {
  it("recognizes stop navigation commands accurately", () => {
    expect(parseVoiceCommand("stop navigation").intent).toBe("stop_navigation");
    expect(parseVoiceCommand("cancel navigation").intent).toBe("stop_navigation");
    expect(parseVoiceCommand("end navigation").intent).toBe("stop_navigation");
  });

  it("recognizes recenter map commands accurately", () => {
    expect(parseVoiceCommand("recenter").intent).toBe("recenter_map");
    expect(parseVoiceCommand("recenter map").intent).toBe("recenter_map");
    expect(parseVoiceCommand("center map").intent).toBe("recenter_map");
    expect(parseVoiceCommand("go back to my current location").intent).toBe("recenter_map");
  });

  it("recognizes navigation status and distance queries", () => {
    expect(parseVoiceCommand("how far is my destination").intent).toBe("navigation_status");
    expect(parseVoiceCommand("how far to destination").intent).toBe("navigation_status");
    expect(parseVoiceCommand("distance remaining").intent).toBe("navigation_status");
  });

  it("recognizes nearby amenity searches", () => {
    const res1 = parseVoiceCommand("find a hospital nearby");
    expect(res1.intent).toBe("nearby_places");
    expect(res1.categoryQuery).toBe("hospital");

    const res2 = parseVoiceCommand("what places are near me");
    expect(res2.intent).toBe("nearby_places");
    expect(res2.categoryQuery).toBe("general");

    const res3 = parseVoiceCommand("where is the nearest atm");
    expect(res3.intent).toBe("nearby_places");
    expect(res3.categoryQuery).toBe("atm");
  });

  it("recognizes road inquiries as where_am_i intent", () => {
    expect(parseVoiceCommand("what is that road called").intent).toBe("where_am_i");
    expect(parseVoiceCommand("what road is this").intent).toBe("where_am_i");
  });

  it("recognizes 'take me somewhere else' as navigate_to with empty query", () => {
    const res = parseVoiceCommand("take me somewhere else");
    expect(res.intent).toBe("navigate_to");
    expect(res.destinationQuery).toBe("");
  });

  it("dispatches in-map actions when on navigation screen", async () => {
    const onMapSearchDestination = jest.fn<any>();
    const onMapStopNav = jest.fn<any>();
    const onMapRecenter = jest.fn<any>();
    const onMapRepeat = jest.fn<any>();
    const onMapWhereAmI = jest.fn<any>();

    const ctx: VoiceCommandDispatchContext = {
      currentScreen: "navigation",
      onMapSearchDestination: onMapSearchDestination as any,
      onMapStopNavigation: onMapStopNav as any,
      onMapRecenter: onMapRecenter as any,
      onMapRepeatInstruction: onMapRepeat as any,
      onMapWhereAmI: onMapWhereAmI as any,
    };

    // 1. Destination search in-map
    await dispatchVoiceCommand("take me to civil hospital", ctx);
    expect(onMapSearchDestination).toHaveBeenCalledWith("civil hospital");

    // 2. Stop navigation in-map
    await dispatchVoiceCommand("stop navigation", ctx);
    expect(onMapStopNav).toHaveBeenCalled();

    // 3. Recenter map
    await dispatchVoiceCommand("recenter map", ctx);
    expect(onMapRecenter).toHaveBeenCalled();

    // 4. Repeat instruction in-map
    await dispatchVoiceCommand("repeat instruction", ctx);
    expect(onMapRepeat).toHaveBeenCalled();

    // 5. Where am I in-map
    await dispatchVoiceCommand("where am i", ctx);
    expect(onMapWhereAmI).toHaveBeenCalled();
  });
});
