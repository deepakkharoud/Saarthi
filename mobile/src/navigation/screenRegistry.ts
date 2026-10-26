import type { AppScreen } from "../../App";

export type { AppScreen };

export interface ScreenRegistryEntry {
  screen: AppScreen;
  screenName: string;
  purpose: string;
  availableActions: string[];
  whereAmI: string;
  whatCanIDo: string;
}

/**
 * Screen Registry for SAARTHI Voice Companion.
 * Provides clear, conversational spoken guidance for blind and low-vision students.
 * Rule 1: No hallucinations — only genuine, working features are documented.
 * Rule 4: Fail audible — explicit and short spoken feedback suitable for TTS.
 */
export const SCREEN_REGISTRY: Record<AppScreen, ScreenRegistryEntry> = {
  home: {
    screen: "home",
    screenName: "Home",
    purpose: "Main campus launchpad with four tactile corner panels.",
    availableActions: [
      "Open Campus Reader to scan text and signs",
      "Open Campus Navigation for accessible routes",
      "Open My Timetable to manage your schedule",
      "Open Voice Assistant to ask questions",
      "Check backend connection and AI status",
      "Open Settings",
    ],
    whereAmI: "You are on the Home screen. This is the main campus menu.",
    whatCanIDo:
      "From the Home screen, you can open Campus Reader to scan text and signs, open Campus Navigation for accessible routes, check your Timetable, open the Voice Assistant, or open Settings.",
  },

  reader: {
    screen: "reader",
    screenName: "Campus Reader",
    purpose: "Real-time camera scanner for door plaques, schedules, notices, and surroundings.",
    availableActions: [
      "Say 'scan now' or tap the screen to take a scan",
      "Scan in Auto Read mode for general printed text",
      "Scan in Door Sign mode for classroom plaques and room numbers",
      "Scan in Timetable mode for class schedules",
      "Scan in Notice mode for campus posters and bulletin boards",
      "Scan Surroundings to describe obstacles and doors in view",
      "Hear spoken screen instructions",
      "Say 'go home' to return to the Home screen",
    ],
    whereAmI:
      "You are on the Campus Reader screen. Point your camera at text or signs to scan.",
    whatCanIDo:
      "You can say 'scan now' or tap to capture, say 'describe surroundings', listen to instructions, or say 'go home'.",
  },

  results: {
    screen: "results",
    screenName: "Reading Results",
    purpose: "Displays and speaks the structured information extracted from your latest scan.",
    availableActions: [
      "Say 'read the full text' to hear verbatim source text",
      "Say 'summarize this' to hear a concise summary",
      "Say 'repeat' to replay the latest message",
      "Say 'stop' to immediately silence speech",
      "Say 'scan again' to return to the camera for another scan",
      "Say 'go home' to return to the Home screen",
      "Save extracted classes to your personal timetable",
      "Set scanned room as your navigation starting point",
    ],
    whereAmI: "You are on the Reading Results screen, viewing your latest scan.",
    whatCanIDo:
      "You can say 'read the full text', 'summarize this', 'repeat', 'stop', 'scan again', or 'go home'.",
  },

  timetable: {
    screen: "timetable",
    screenName: "My Timetable",
    purpose: "Weekly course schedule manager with next-class countdowns.",
    availableActions: [
      "Hear when your next class is",
      "Scan a timetable with the camera",
      "Filter classes by day of the week",
      "Add a new class manually",
      "Edit or delete an existing class",
      "Return to the Home screen",
    ],
    whereAmI:
      "You are on the Timetable screen, where your weekly university schedule is stored.",
    whatCanIDo:
      "You can check when your next class meets, scan a printed schedule with your camera, filter by day, add or edit classes, or return home.",
  },

  navigation: {
    screen: "navigation",
    screenName: "Campus Navigation",
    purpose: "Accessible indoor turn-by-turn guidance between campus rooms and landmarks.",
    availableActions: [
      "Search for a destination landmark or room",
      "Calculate an accessible route",
      "Toggle stairs avoidance on or off",
      "Advance to the next route step",
      "Repeat the current route step",
      "Cancel active navigation",
      "Return to the Home screen",
    ],
    whereAmI:
      "You are on the Campus Navigation screen for turn-by-turn campus routing.",
    whatCanIDo:
      "You can search for a campus destination, calculate an accessible route avoiding stairs, advance or repeat route steps, cancel navigation, or return home.",
  },

  voice: {
    screen: "voice",
    screenName: "Voice Assistant",
    purpose: "Voice companion for asking campus questions and dispatching voice commands.",
    availableActions: [
      "Say 'Go Home', 'Open Reader', 'Open Timetable', 'Open Navigation', or 'Open Settings'",
      "Say 'Go Back' to return to the previous screen",
      "Ask 'Where am I?' to hear your current screen",
      "Ask 'What can I do here?' or 'Help' to hear available actions",
      "Ask 'When is my next class?'",
      "Say 'Read this sign' or 'Read timetable' to open the scanner",
      "Say 'What is ahead?' to describe your surroundings",
      "Ask for navigation directions to a room or building",
      "Say 'Stop' to cut off speech or 'Repeat' to hear the last message",
      "Type a question manually if voice recognition is unavailable",
      "Return to the Home screen",
    ],
    whereAmI: "You are on the Voice Assistant screen.",
    whatCanIDo:
      "You can navigate to any screen by saying 'Go Home', 'Open Reader', 'Open Navigation', 'Open Timetable', or 'Go Back'. You can also ask 'Where am I?', 'What can I do here?', 'When is my next class?', or ask for directions.",
  },

  settings: {
    screen: "settings",
    screenName: "Settings",
    purpose: "Diagnostic connection controls and audio preferences.",
    availableActions: [
      "Test connection to the SAARTHI backend server",
      "Configure the backend server address",
      "Enable or disable automatic voice announcements",
      "Replay the spoken welcome tutorial",
      "Return to the Home screen",
    ],
    whereAmI: "You are on the Settings screen.",
    whatCanIDo:
      "You can test the server connection, configure the backend server address, toggle voice speech on or off, replay the spoken welcome tutorial, or return home.",
  },

  assist: {
    screen: "assist",
    screenName: "Live Camera Assist",
    purpose: "Real-time camera preview with Gemma 4 vision scene analysis and obstacle awareness.",
    availableActions: [
      "Say 'Describe what is ahead' or tap Describe Now to inspect your surroundings",
      "Say 'Stop' to cut off speech or stop analysis immediately",
      "Pause or resume continuous streaming",
      "Return to the Home screen or Campus Map",
    ],
    whereAmI:
      "You are on the Live Camera Assist screen. Camera preview is streaming to Gemma 4.",
    whatCanIDo:
      "You can tap Describe Now or say 'What is ahead' to inspect what is in front of you, toggle live streaming, say 'Stop' to silence audio, or return home.",
  },
};

/**
 * Look up the registry entry for a given screen.
 * Falls back safely to 'home' if an unexpected key is provided.
 */
export function getScreenRegistryEntry(screen: AppScreen): ScreenRegistryEntry {
  return SCREEN_REGISTRY[screen] || SCREEN_REGISTRY.home;
}

/**
 * Return all registered screen entries.
 */
export function getAllScreenRegistryEntries(): ScreenRegistryEntry[] {
  return Object.values(SCREEN_REGISTRY);
}

/**
 * Helper to get the conversational "Where am I?" description.
 */
export function describeWhereAmI(screen: AppScreen): string {
  return getScreenRegistryEntry(screen).whereAmI;
}

/**
 * Helper to get the conversational "What can I do here?" description.
 */
export function describeWhatCanIDo(screen: AppScreen): string {
  return getScreenRegistryEntry(screen).whatCanIDo;
}
