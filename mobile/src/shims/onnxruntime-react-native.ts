const unsupported = (): never => {
  throw new Error(
    "Silero VAD needs onnxruntime-react-native. Saarthi's wake-word listener does not use Silero VAD.",
  );
};

export class Tensor {
  constructor(..._args: unknown[]) {
    unsupported();
  }
}

export class InferenceSession {
  static async create(..._args: unknown[]): Promise<never> {
    return unsupported();
  }
}
