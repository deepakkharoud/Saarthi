const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The wake-word library re-exports its optional Silero VAD provider from its
// root entrypoint. Metro therefore resolves this optional peer even though
// Saarthi only uses native wake-word detection and never enables Silero VAD.
// Keep the VAD dependency explicit and fail clearly if it is enabled later.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-voice-activator") {
    // Avoid the package root barrel, which eagerly re-exports optional Whisper,
    // TTS, and VAD providers that Saarthi does not use for wake-word detection.
    return {
      type: "sourceFile",
      filePath: path.resolve(
        __dirname,
        "node_modules/react-native-voice-activator/src/public/voice-activator.ts",
      ),
    };
  }

  if (moduleName === "onnxruntime-react-native") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/shims/onnxruntime-react-native.ts"),
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
