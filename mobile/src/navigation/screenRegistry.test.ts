import { describe, it, expect } from "@jest/globals";
import {
  SCREEN_REGISTRY,
  getScreenRegistryEntry,
  getAllScreenRegistryEntries,
  describeWhereAmI,
  describeWhatCanIDo,
} from "./screenRegistry";
import type { AppScreen } from "../../App";

describe("screenRegistry — Screen Awareness Registry", () => {
  const validScreens: AppScreen[] = [
    "home",
    "reader",
    "results",
    "timetable",
    "navigation",
    "voice",
    "settings",
    "assist",
  ];

  it("contains an entry for every valid AppScreen without missing definitions", () => {
    validScreens.forEach((screen) => {
      const entry = SCREEN_REGISTRY[screen];
      expect(entry).toBeDefined();
      expect(entry.screen).toBe(screen);
    });
    expect(Object.keys(SCREEN_REGISTRY).sort()).toEqual([...validScreens].sort());
  });

  it("provides meaningful screen name and purpose for every screen", () => {
    getAllScreenRegistryEntries().forEach((entry) => {
      expect(entry.screenName).toBeDefined();
      expect(entry.screenName.trim().length).toBeGreaterThan(0);
      expect(entry.purpose).toBeDefined();
      expect(entry.purpose.trim().length).toBeGreaterThan(10);
    });
  });

  it("provides available-action guidance for every screen with genuine non-empty actions", () => {
    getAllScreenRegistryEntries().forEach((entry) => {
      expect(entry.availableActions).toBeInstanceOf(Array);
      expect(entry.availableActions.length).toBeGreaterThan(0);
      entry.availableActions.forEach((action) => {
        expect(action.trim().length).toBeGreaterThan(0);
      });
      // Conversational responses must not be empty
      expect(entry.whereAmI.trim().length).toBeGreaterThan(15);
      expect(entry.whatCanIDo.trim().length).toBeGreaterThan(15);
    });
  });

  it("describeWhereAmI returns distinct conversational descriptions per screen", () => {
    const homeDesc = describeWhereAmI("home");
    const readerDesc = describeWhereAmI("reader");
    const navDesc = describeWhereAmI("navigation");
    const timetableDesc = describeWhereAmI("timetable");

    expect(homeDesc).toContain("Home");
    expect(readerDesc).toContain("Reader");
    expect(navDesc).toContain("Navigation");
    expect(timetableDesc).toContain("Timetable");
    expect(homeDesc).not.toEqual(readerDesc);
    expect(homeDesc).not.toEqual(navDesc);
  });

  it("describeWhatCanIDo returns specific available actions per screen", () => {
    const readerActions = describeWhatCanIDo("reader");
    const timetableActions = describeWhatCanIDo("timetable");
    const settingsActions = describeWhatCanIDo("settings");

    expect(readerActions.toLowerCase()).toContain("scan");
    expect(timetableActions.toLowerCase()).toContain("class");
    expect(settingsActions.toLowerCase()).toContain("server");
    expect(readerActions).not.toEqual(timetableActions);
  });

  it("falls back safely to home if an unexpected screen key is passed", () => {
    const fallback = getScreenRegistryEntry("unknown_screen" as unknown as AppScreen);
    expect(fallback).toBeDefined();
    expect(fallback.screen).toBe("home");
  });
});
