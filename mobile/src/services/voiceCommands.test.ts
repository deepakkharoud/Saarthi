import { describe, it, expect } from "@jest/globals";
import {
  parseVoiceCommand,
  SCREEN_INTENT_MAP,
  NavigationIntentType,
} from "./voiceCommands";

describe("voiceCommands — Deterministic Intent Parsing", () => {
  // 1. Recognition of "Where am I?"
  it("recognizes 'Where am I?' and related variations", () => {
    expect(parseVoiceCommand("Where am I?").intent).toBe("where_am_i");
    expect(parseVoiceCommand("where am i").intent).toBe("where_am_i");
    expect(parseVoiceCommand("where am i now").intent).toBe("where_am_i");
    expect(parseVoiceCommand("what room is this?").intent).toBe("where_am_i");
    expect(parseVoiceCommand("my location").intent).toBe("where_am_i");
  });

  // 2. Recognition of "What screen am I on?"
  it("recognizes 'What screen am I on?' and related variations", () => {
    expect(parseVoiceCommand("What screen am I on?").intent).toBe("where_am_i");
    expect(parseVoiceCommand("what screen is this").intent).toBe("where_am_i");
    expect(parseVoiceCommand("which screen am i on").intent).toBe("where_am_i");
    expect(parseVoiceCommand("current screen").intent).toBe("where_am_i");
    expect(parseVoiceCommand("tell me what screen i am on").intent).toBe("where_am_i");
  });

  // 3. Recognition of "What can I do here?"
  it("recognizes 'What can I do here?' and related variations", () => {
    expect(parseVoiceCommand("What can I do here?").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("what can i do").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("what can i do on this screen").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("what are my options").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("what can i say").intent).toBe("what_can_i_do");
  });

  // 4. Recognition of "Help"
  it("recognizes 'Help' and help-related queries", () => {
    expect(parseVoiceCommand("Help").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("help me").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("commands").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("show commands").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("instructions").intent).toBe("what_can_i_do");
  });

  // 5. Recognition of "Repeat that"
  it("recognizes 'Repeat that' and replay variations", () => {
    expect(parseVoiceCommand("Repeat that").intent).toBe("repeat");
    expect(parseVoiceCommand("repeat that please").intent).toBe("repeat");
    expect(parseVoiceCommand("say that again").intent).toBe("repeat");
    expect(parseVoiceCommand("say again").intent).toBe("repeat");
    expect(parseVoiceCommand("repeat").intent).toBe("repeat");
    expect(parseVoiceCommand("repeat instruction").intent).toBe("repeat");
    expect(parseVoiceCommand("what did you say").intent).toBe("repeat");
    expect(parseVoiceCommand("pardon").intent).toBe("repeat");
    expect(parseVoiceCommand("one more time").intent).toBe("repeat");
  });

  // 6. Recognition of "Stop speaking"
  it("recognizes 'Stop speaking' and silence variations", () => {
    expect(parseVoiceCommand("Stop speaking").intent).toBe("stop");
    expect(parseVoiceCommand("stop speaking now").intent).toBe("stop");
    expect(parseVoiceCommand("stop talking").intent).toBe("stop");
    expect(parseVoiceCommand("stop reading").intent).toBe("stop");
    expect(parseVoiceCommand("stop").intent).toBe("stop");
    expect(parseVoiceCommand("cancel").intent).toBe("stop");
    expect(parseVoiceCommand("silence").intent).toBe("stop");
    expect(parseVoiceCommand("be quiet").intent).toBe("stop");
  });

  // 7. Case and punctuation normalization
  it("normalizes case and harmless punctuation consistently", () => {
    expect(parseVoiceCommand("WHERE AM I?!").intent).toBe("where_am_i");
    expect(parseVoiceCommand("  wHaT sCrEeN aM i On???  ").intent).toBe("where_am_i");
    expect(parseVoiceCommand("What can I do here...").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("HELP!!!").intent).toBe("what_can_i_do");
    expect(parseVoiceCommand("Repeat that, please!").intent).toBe("repeat");
    expect(parseVoiceCommand("STOP SPEAKING.").intent).toBe("stop");
    expect(parseVoiceCommand("GO HOME!").intent).toBe("open_home");
    expect(parseVoiceCommand("Open Campus Reader...").intent).toBe("open_reader");
    expect(parseVoiceCommand("GO BACK?!").intent).toBe("go_back");
  });

  // 8. Phase 2: Global Voice Navigation Commands & Natural Language Aliases
  describe("Phase 2 — Navigation Intents and Screen Mapping", () => {
    it("recognizes 'Open Home' / 'Go Home' / 'Return Home' aliases", () => {
      const res1 = parseVoiceCommand("Open Home");
      expect(res1.intent).toBe("open_home");
      expect(res1.targetScreen).toBe("home");

      expect(parseVoiceCommand("Go Home").intent).toBe("open_home");
      expect(parseVoiceCommand("Return Home").intent).toBe("open_home");
      expect(parseVoiceCommand("home").intent).toBe("open_home");
      expect(parseVoiceCommand("main menu").intent).toBe("open_home");
      expect(parseVoiceCommand("take me home").intent).toBe("open_home");
    });

    it("recognizes 'Open Campus Reader' / 'Open Reader' / 'Scan' aliases", () => {
      const res1 = parseVoiceCommand("Open Campus Reader");
      expect(res1.intent).toBe("open_reader");
      expect(res1.targetScreen).toBe("reader");

      expect(parseVoiceCommand("Open Reader").intent).toBe("open_reader");
      expect(parseVoiceCommand("Scan").intent).toBe("open_reader");
      expect(parseVoiceCommand("start scanning").intent).toBe("open_reader");
      expect(parseVoiceCommand("open scanner").intent).toBe("open_reader");
      expect(parseVoiceCommand("campus reader").intent).toBe("open_reader");
    });

    it("recognizes 'Open Results' / 'Show Results' aliases", () => {
      const res1 = parseVoiceCommand("Open Results");
      expect(res1.intent).toBe("open_results");
      expect(res1.targetScreen).toBe("results");

      expect(parseVoiceCommand("Show Results").intent).toBe("open_results");
      expect(parseVoiceCommand("reading results").intent).toBe("open_results");
      expect(parseVoiceCommand("view results").intent).toBe("open_results");
      expect(parseVoiceCommand("open reading results").intent).toBe("open_results");
    });

    it("recognizes 'Open Timetable' / 'Show Timetable' / 'My Schedule' aliases including spaced 'time table'", () => {
      // 1. "open timetable" and "open time table"
      const res1 = parseVoiceCommand("open timetable");
      expect(res1.intent).toBe("open_timetable");
      expect(res1.targetScreen).toBe("timetable");

      const res2 = parseVoiceCommand("open time table");
      expect(res2.intent).toBe("open_timetable");
      expect(res2.targetScreen).toBe("timetable");

      // 2. "open my timetable" and "open my time table"
      expect(parseVoiceCommand("open my timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("open my time table").intent).toBe("open_timetable");

      // 3. "show timetable" and "show time table"
      expect(parseVoiceCommand("show timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("show time table").intent).toBe("open_timetable");

      // 4. "show my timetable" and "show my time table"
      expect(parseVoiceCommand("show my timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("show my time table").intent).toBe("open_timetable");

      // 5. "open class timetable" and "open class time table"
      expect(parseVoiceCommand("open class timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("open class time table").intent).toBe("open_timetable");
      expect(parseVoiceCommand("class timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("class time table").intent).toBe("open_timetable");

      // 6. Schedule variations
      expect(parseVoiceCommand("My Schedule").intent).toBe("open_timetable");
      expect(parseVoiceCommand("open schedule").intent).toBe("open_timetable");
      expect(parseVoiceCommand("show schedule").intent).toBe("open_timetable");
      expect(parseVoiceCommand("my timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("timetable").intent).toBe("open_timetable");
      expect(parseVoiceCommand("time table").intent).toBe("open_timetable");

      // 7. Case, spacing, and punctuation normalization
      expect(parseVoiceCommand("OPEN TIME TABLE").intent).toBe("open_timetable");
      expect(parseVoiceCommand("  open   time   table?!  ").intent).toBe("open_timetable");
      expect(parseVoiceCommand("Open Time-Table").intent).toBe("open_timetable");
      expect(parseVoiceCommand("Show My Time Table...").intent).toBe("open_timetable");
    });

    it("recognizes 'Open Navigation' / 'Navigate' / 'Find a Room' aliases", () => {
      const res1 = parseVoiceCommand("Open Navigation");
      expect(res1.intent).toBe("open_navigation");
      expect(res1.targetScreen).toBe("navigation");

      expect(parseVoiceCommand("Navigate").intent).toBe("open_navigation");
      expect(parseVoiceCommand("Find a Room").intent).toBe("open_navigation");
      expect(parseVoiceCommand("campus navigation").intent).toBe("open_navigation");
      expect(parseVoiceCommand("find room").intent).toBe("open_navigation");
      expect(parseVoiceCommand("open campus navigation").intent).toBe("open_navigation");
    });

    it("recognizes 'Open Voice Assistant' / 'Open Voice' / 'Voice Help' aliases", () => {
      const res1 = parseVoiceCommand("Open Voice Assistant");
      expect(res1.intent).toBe("open_voice");
      expect(res1.targetScreen).toBe("voice");

      expect(parseVoiceCommand("Open Voice").intent).toBe("open_voice");
      expect(parseVoiceCommand("Voice Help").intent).toBe("open_voice");
      expect(parseVoiceCommand("voice assistant").intent).toBe("open_voice");
      expect(parseVoiceCommand("open assistant").intent).toBe("open_voice");
    });

    it("recognizes 'Open Settings' / 'Change Settings' aliases", () => {
      const res1 = parseVoiceCommand("Open Settings");
      expect(res1.intent).toBe("open_settings");
      expect(res1.targetScreen).toBe("settings");

      expect(parseVoiceCommand("Change Settings").intent).toBe("open_settings");
      expect(parseVoiceCommand("settings").intent).toBe("open_settings");
      expect(parseVoiceCommand("preferences").intent).toBe("open_settings");
      expect(parseVoiceCommand("open configuration").intent).toBe("open_settings");
    });

    it("recognizes 'Go Back' / 'Back' / 'Previous Screen' aliases", () => {
      const res1 = parseVoiceCommand("Go Back");
      expect(res1.intent).toBe("go_back");

      expect(parseVoiceCommand("Back").intent).toBe("go_back");
      expect(parseVoiceCommand("Previous Screen").intent).toBe("go_back");
      expect(parseVoiceCommand("return").intent).toBe("go_back");
      expect(parseVoiceCommand("take me back").intent).toBe("go_back");
      expect(parseVoiceCommand("go to previous screen").intent).toBe("go_back");
    });

    it("correctly maps all navigation intents to existing screen IDs in SCREEN_INTENT_MAP", () => {
      const expectedMapping: Record<NavigationIntentType, string> = {
        open_home: "home",
        open_reader: "reader",
        open_results: "results",
        open_timetable: "timetable",
        open_navigation: "navigation",
        open_voice: "voice",
        open_settings: "settings",
        open_assist: "assist",
      };

      Object.entries(expectedMapping).forEach(([intent, screenId]) => {
        expect(SCREEN_INTENT_MAP[intent as NavigationIntentType]).toBe(screenId);
      });
    });
  });

  // 9. Existing intents remaining functional
  describe("existing intents remain functional", () => {
    it("parses 'Read this.' intent correctly", () => {
      expect(parseVoiceCommand("Read this.").intent).toBe("read_this");
      expect(parseVoiceCommand("read the sign").intent).toBe("read_this");
      expect(parseVoiceCommand("read noticeboard!").intent).toBe("read_this");
    });

    it("parses specific reading modes for timetable, room number, and notice", () => {
      const timetableCmd = parseVoiceCommand("Read the timetable.");
      expect(timetableCmd.intent).toBe("read_this");
      expect(timetableCmd.readingMode).toBe("timetable");

      const signCmd = parseVoiceCommand("Read this room number.");
      expect(signCmd.intent).toBe("read_this");
      expect(signCmd.readingMode).toBe("sign");

      const noticeCmd = parseVoiceCommand("Summarize this notice.");
      expect(noticeCmd.intent).toBe("read_this");
      expect(noticeCmd.readingMode).toBe("notice");
    });

    it("parses 'What is ahead?' intent correctly", () => {
      expect(parseVoiceCommand("What is ahead?").intent).toBe("what_is_ahead");
      expect(parseVoiceCommand("what's ahead").intent).toBe("what_is_ahead");
      expect(parseVoiceCommand("what do you see in front of me").intent).toBe("what_is_ahead");
    });

    it("parses 'When is my next class?' intent correctly", () => {
      expect(parseVoiceCommand("When is my next class?").intent).toBe("next_class");
      expect(parseVoiceCommand("next class").intent).toBe("next_class");
      expect(parseVoiceCommand("my next class").intent).toBe("next_class");
      expect(parseVoiceCommand("what class is next?").intent).toBe("next_class");
    });

    it("parses 'Take me to <place>' intent correctly extracting destination query", () => {
      const res1 = parseVoiceCommand("Take me to the library.");
      expect(res1.intent).toBe("navigate_to");
      expect(res1.destinationQuery).toBe("library");

      const res2 = parseVoiceCommand("Take me to Room 204");
      expect(res2.intent).toBe("navigate_to");
      expect(res2.destinationQuery).toBe("room 204");

      const res3 = parseVoiceCommand("directions to science center");
      expect(res3.intent).toBe("navigate_to");
      expect(res3.destinationQuery).toBe("science center");
    });
  });

  // 10. Voice Mode Control Commands & Intent Conflict Resolution
  describe("Global Voice Mode Commands and Conflict Resolution", () => {
    it("recognizes 'stop listening' and pauses listening without triggering general stop", () => {
      expect(parseVoiceCommand("stop listening").intent).toBe("stop_listening");
      expect(parseVoiceCommand("pause listening").intent).toBe("stop_listening");
      expect(parseVoiceCommand("pause voice").intent).toBe("stop_listening");
      expect(parseVoiceCommand("mute microphone").intent).toBe("stop_listening");
      expect(parseVoiceCommand("mute mic").intent).toBe("stop_listening");
    });

    it("recognizes 'resume listening' and starts listening again", () => {
      expect(parseVoiceCommand("resume listening").intent).toBe("resume_listening");
      expect(parseVoiceCommand("start listening").intent).toBe("resume_listening");
      expect(parseVoiceCommand("continue listening").intent).toBe("resume_listening");
      expect(parseVoiceCommand("unpause listening").intent).toBe("resume_listening");
      expect(parseVoiceCommand("resume voice").intent).toBe("resume_listening");
    });

    it("recognizes 'exit voice mode' to turn off voice mode entirely", () => {
      expect(parseVoiceCommand("exit voice mode").intent).toBe("exit_voice_mode");
      expect(parseVoiceCommand("turn off voice mode").intent).toBe("exit_voice_mode");
      expect(parseVoiceCommand("disable voice mode").intent).toBe("exit_voice_mode");
      expect(parseVoiceCommand("quit voice mode").intent).toBe("exit_voice_mode");
      expect(parseVoiceCommand("turn off voice").intent).toBe("exit_voice_mode");
    });

    it("deliberately resolves conflicts between stop, stop listening, exit voice mode, and repeat", () => {
      // General TTS speech stop
      expect(parseVoiceCommand("stop").intent).toBe("stop");
      expect(parseVoiceCommand("stop speaking").intent).toBe("stop");
      expect(parseVoiceCommand("stop talking").intent).toBe("stop");
      expect(parseVoiceCommand("quiet").intent).toBe("stop");

      // Specific microphone pause
      expect(parseVoiceCommand("stop listening").intent).toBe("stop_listening");

      // Specific voice mode exit
      expect(parseVoiceCommand("exit voice mode").intent).toBe("exit_voice_mode");
      expect(parseVoiceCommand("stop voice mode").intent).toBe("exit_voice_mode");

      // Repeat instruction
      expect(parseVoiceCommand("repeat that").intent).toBe("repeat");
      expect(parseVoiceCommand("say that again").intent).toBe("repeat");
    });
  });

  // 11. Voice-First Auto Read & Results Commands
  describe("Voice-First Auto Read & Results Commands", () => {
    it("recognizes 'scan now' and capture variations", () => {
      expect(parseVoiceCommand("scan now").intent).toBe("scan_now");
      expect(parseVoiceCommand("capture").intent).toBe("scan_now");
      expect(parseVoiceCommand("capture now").intent).toBe("scan_now");
      expect(parseVoiceCommand("take photo").intent).toBe("scan_now");
      expect(parseVoiceCommand("take picture").intent).toBe("scan_now");
      expect(parseVoiceCommand("take a photo").intent).toBe("scan_now");
      expect(parseVoiceCommand("take a picture").intent).toBe("scan_now");
      expect(parseVoiceCommand("start scan").intent).toBe("scan_now");
      expect(parseVoiceCommand("snap photo").intent).toBe("scan_now");
      expect(parseVoiceCommand("scan this").intent).toBe("scan_now");
      expect(parseVoiceCommand("take scan").intent).toBe("scan_now");
    });

    it("recognizes 'read the full text' and verbatim text variations", () => {
      expect(parseVoiceCommand("read the full text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("read full text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("full text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("read all text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("read source text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("source text").intent).toBe("read_full_text");
      expect(parseVoiceCommand("read verbatim").intent).toBe("read_full_text");
      expect(parseVoiceCommand("read everything").intent).toBe("read_full_text");
    });

    it("recognizes 'summarize this' and summary variations", () => {
      expect(parseVoiceCommand("summarize this").intent).toBe("summarize_this");
      expect(parseVoiceCommand("summarize").intent).toBe("summarize_this");
      expect(parseVoiceCommand("summary").intent).toBe("summarize_this");
      expect(parseVoiceCommand("read summary").intent).toBe("summarize_this");
      expect(parseVoiceCommand("give summary").intent).toBe("summarize_this");
      expect(parseVoiceCommand("give me a summary").intent).toBe("summarize_this");
      expect(parseVoiceCommand("what does it say").intent).toBe("summarize_this");
      expect(parseVoiceCommand("what does this say").intent).toBe("summarize_this");
    });

    it("recognizes 'scan again' and re-scan variations", () => {
      expect(parseVoiceCommand("scan again").intent).toBe("scan_again");
      expect(parseVoiceCommand("scan another").intent).toBe("scan_again");
      expect(parseVoiceCommand("scan another one").intent).toBe("scan_again");
      expect(parseVoiceCommand("new scan").intent).toBe("scan_again");
      expect(parseVoiceCommand("take another scan").intent).toBe("scan_again");
      expect(parseVoiceCommand("take another photo").intent).toBe("scan_again");
      expect(parseVoiceCommand("rescan").intent).toBe("scan_again");
      expect(parseVoiceCommand("re-scan").intent).toBe("scan_again");
      expect(parseVoiceCommand("another scan").intent).toBe("scan_again");
    });
  });

  // 12. Unknown phrases not triggering unintended actions
  it("does not trigger unintended actions on unknown phrases", () => {
    const unk1 = parseVoiceCommand("Tell me a funny joke");
    expect(unk1.intent).toBe("unknown");
    expect(unk1.confidence).toBeLessThan(0.5);

    const unk2 = parseVoiceCommand("What is the capital of France?");
    expect(unk2.intent).toBe("unknown");

    const unk3 = parseVoiceCommand("play my favorite song");
    expect(unk3.intent).toBe("unknown");

    const unk4 = parseVoiceCommand("");
    expect(unk4.intent).toBe("unknown");
  });
});

