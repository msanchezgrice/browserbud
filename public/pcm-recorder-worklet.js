class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requestedChunkSize = options?.processorOptions?.chunkSize;
    this.chunkSize = Number.isInteger(requestedChunkSize) && requestedChunkSize > 0 ? requestedChunkSize : 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    let cursor = 0;
    while (cursor < input.length) {
      const remaining = this.chunkSize - this.offset;
      const amount = Math.min(remaining, input.length - cursor);
      this.buffer.set(input.subarray(cursor, cursor + amount), this.offset);
      this.offset += amount;
      cursor += amount;

      if (this.offset >= this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-recorder-processor', PcmRecorderProcessor);
