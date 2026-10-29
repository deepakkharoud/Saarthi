import { describe, expect, it } from "@jest/globals";
import { isSaarthiWakeTranscript } from "./wakeWord";

describe("isSaarthiWakeTranscript", () => {
  it.each([
    "Hey Saarthi",
    "HEY, SAARTHI!",
    "hey sarthi",
    "Hey Sarathi",
    "Hey Saathi",
    "Hey SRT",
    "Hey Srthi",
    "hai saarthi",
    "हे सारथी",
    "हे साथी",
    "है सारथी",
    "Could you hear me, hey Saarthi",
  ])("recognizes the Saarthi wake phrase in %s", (transcript) => {
    expect(isSaarthiWakeTranscript(transcript)).toBe(true);
  });

  it.each(["Saarthi", "SRT", "Hey there", "I am sorry", "Campus map please"])(
    "does not trigger for %s",
    (transcript) => {
      expect(isSaarthiWakeTranscript(transcript)).toBe(false);
    },
  );
});
