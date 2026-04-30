import { NextResponse } from 'next/server';
import { StreamResponseChunk } from './types';

const encoder = new TextEncoder();

export function stream(
  iterator: AsyncGenerator<Uint8Array, NextResponse | undefined, unknown>
) {
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        console.error('[stream] generator error:', err);
        const errorChunk = encoder.encode(
          JSON.stringify({ type: 'response', text: '\n\n⚠️ Bir hata oluştu. Lütfen tekrar deneyin.' })
        );
        controller.enqueue(errorChunk);
        controller.close();
      }
    },
  });
}

export function formatStreamChunk(chunk: StreamResponseChunk): Uint8Array {
  return encoder.encode(JSON.stringify(chunk));
}
