import type { TelemetryEnvelope } from "../../../src/runtime/types";
import type { Aggregator } from "./aggregator";

const encoder = new TextEncoder();
const OPENING_COMMENT = ": telemetry-map stream open\n\n";

const frame = (event: TelemetryEnvelope): Uint8Array =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

// A Server-Sent-Events response backed by an aggregator client registration.
// The stream lives until the client disconnects (cancel) or an enqueue fails.
export const streamResponse = (aggregator: Aggregator): Response => {
  let remove: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(OPENING_COMMENT));
      remove = aggregator.addClient((event) => {
        try {
          controller.enqueue(frame(event));
        } catch {
          remove?.();
        }
      });
    },
    cancel() {
      remove?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
};
