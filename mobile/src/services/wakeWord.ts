// Indian-accented English commonly pronounces/writes the name as Saarthi,
// Sarthi, or Sarathi. Sherpa's open-vocabulary spotter accepts phrase aliases;
// keep the distinct two-word trigger while covering those pronunciations.
export const SAARTHI_WAKE_PHRASES = [
  "hey saarthi",
  "hey sarthi",
  "hey sarathi",
] as const;

const NORMALIZED_WAKE_NAMES = new Set([
  "saarthi",
  "saarathi",
  "sarthi",
  "sarth",
  "sarathi",
  "sarti",
  "saathi",
  "sathi",
  "srt",
  "srti",
  "srthi",
  "sharthi",
]);

const HINDI_WAKE_PHRASES = [
  "हे सारथी",
  "हे सारथि",
  "हे साथी",
  "है सारथी",
  "है सारथि",
  "है साथी",
];

export function isSaarthiWakeTranscript(transcript: string): boolean {
  const raw = transcript.toLocaleLowerCase();
  const normalizedHindi = raw.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  if (
    HINDI_WAKE_PHRASES.some((phrase) =>
      normalizedHindi.includes(phrase.replace(/\s+/g, " ").trim()),
    )
  ) {
    return true;
  }

  const words = raw.replace(/[^a-z]+/g, " ").trim().split(/\s+/);
  return words.some(
    (word, index) =>
      ["hey", "hai", "he", "hi"].includes(word) &&
      NORMALIZED_WAKE_NAMES.has(words[index + 1] ?? ""),
  );
}

export const WAKE_WORD_GREETING =
  "I’m listening. Say Read Anything, Campus Map, My Day, or Talk to Saarthi.";
