// ============================================================================
// SAY AH — COACH VOICE WORKER
//
// Hosts Kokoro (kokoro-js + onnxruntime-web) in a dedicated Web Worker so all
// synthesis runs OFF the main thread. onnxruntime's wasm inference is heavy and
// single-threaded; running it on the UI thread froze the tab for tens of
// seconds. Here it can take as long as it needs without blocking the meter.
//
// Protocol (main → worker):
//   { type: "load" }
//   { type: "generate", id, text, voice, speed }
// (worker → main):
//   { type: "progress", info }       — model download progress
//   { type: "loaded" } | { type: "loadError", message }
//   { type: "audio", id, audio, samplingRate }  (audio buffer transferred)
//   { type: "genError", id, message }
// ============================================================================

// Minimal worker-global typing — avoids pulling the webworker lib into the
// project's DOM-typed tsconfig.
interface WorkerCtx {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
const ctx = self as unknown as WorkerCtx;

interface KokoroInstance {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
  ): Promise<{ audio: Float32Array | ArrayLike<number>; sampling_rate?: number }>;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroInstance | null = null;
let loadPromise: Promise<KokoroInstance> | null = null;

function load(): Promise<KokoroInstance> {
  if (tts) return Promise.resolve(tts);
  if (!loadPromise) {
    loadPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (info: unknown) =>
          ctx.postMessage({ type: "progress", info }),
      })) as unknown as KokoroInstance;
      return tts;
    })();
  }
  return loadPromise;
}

interface InMessage {
  type: "load" | "generate";
  id?: number;
  text?: string;
  voice?: string;
  speed?: number;
}

ctx.onmessage = async (e) => {
  const msg = e.data as InMessage;

  if (msg.type === "load") {
    try {
      await load();
      ctx.postMessage({ type: "loaded" });
    } catch (err) {
      ctx.postMessage({ type: "loadError", message: String(err) });
    }
    return;
  }

  if (msg.type === "generate") {
    try {
      const model = await load();
      const result = await model.generate(msg.text ?? "", {
        voice: msg.voice,
        speed: msg.speed,
      });
      const audio = new Float32Array(result.audio);
      ctx.postMessage(
        {
          type: "audio",
          id: msg.id,
          audio,
          samplingRate: result.sampling_rate ?? 24000,
        },
        [audio.buffer],
      );
    } catch (err) {
      ctx.postMessage({ type: "genError", id: msg.id, message: String(err) });
    }
  }
};
