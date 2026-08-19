import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askBot, type AskHandlers } from './bot';

/** Build a fetch Response whose body streams the given string pieces. */
function streamingResponse(pieces: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

function collect() {
  const deltas: string[] = [];
  const errors: string[] = [];
  const handlers: AskHandlers = {
    onDelta: (text) => deltas.push(text),
    onCitations: vi.fn(),
    onDone: vi.fn(),
    onError: (detail) => errors.push(detail),
  };
  return { handlers, deltas, errors };
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

beforeEach(() => {
  localStorage.setItem('access_token', 'tok-123');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('askBot', () => {
  it('sends the question with a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse([sse({ type: 'done' })]));
    vi.stubGlobal('fetch', fetchMock);

    await askBot('bc-1', 'How much vacation?', collect().handlers);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/bot/conversations/bc-1/ask');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(init.body)).toEqual({ question: 'How much vacation?' });
  });

  it('dispatches citations, deltas and done in order', async () => {
    const citations = [{ index: 1, filename: 'hr.pdf' }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          sse({ type: 'citations', citations }),
          sse({ type: 'delta', content: 'Vacation ' }),
          sse({ type: 'delta', content: 'is 25 days.' }),
          sse({ type: 'done', message_id: 'm-1', failed: false }),
        ]),
      ),
    );

    const { handlers, deltas } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(handlers.onCitations).toHaveBeenCalledWith(citations);
    expect(deltas).toEqual(['Vacation ', 'is 25 days.']);
    expect(handlers.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'm-1', failed: false }),
    );
  });

  it('reassembles a frame split across network reads', async () => {
    // The chunk boundary falls in the middle of the JSON payload.
    const frame = sse({ type: 'delta', content: 'hello world' });
    const cut = Math.floor(frame.length / 2);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamingResponse([frame.slice(0, cut), frame.slice(cut)])),
    );

    const { handlers, deltas } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(deltas).toEqual(['hello world']);
  });

  it('handles several frames arriving in a single read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          sse({ type: 'delta', content: 'a' }) + sse({ type: 'delta', content: 'b' }),
        ]),
      ),
    );

    const { handlers, deltas } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(deltas).toEqual(['a', 'b']);
  });

  it('reports an in-band error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          sse({ type: 'delta', content: 'partial' }),
          sse({ type: 'error', detail: 'The assistant stopped unexpectedly.' }),
        ]),
      ),
    );

    const { handlers, deltas, errors } = collect();
    await askBot('bc-1', 'q', handlers);

    // A partial answer still reaches the UI alongside the error.
    expect(deltas).toEqual(['partial']);
    expect(errors).toEqual(['The assistant stopped unexpectedly.']);
  });

  it('surfaces the API detail on a non-OK response', async () => {
    const response = {
      ok: false,
      status: 503,
      body: null,
      json: async () => ({ detail: 'The assistant is not configured.' }),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const { handlers, errors } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(errors).toEqual(['The assistant is not configured.']);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('falls back to the status code when the error body is not JSON', async () => {
    const response = {
      ok: false,
      status: 502,
      body: null,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const { handlers, errors } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(errors).toEqual(['Request failed (502)']);
  });

  it('ignores malformed frames instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamingResponse([
          'data: {not json\n\n',
          ': keep-alive comment\n\n',
          sse({ type: 'delta', content: 'ok' }),
        ]),
      ),
    );

    const { handlers, deltas, errors } = collect();
    await askBot('bc-1', 'q', handlers);

    expect(deltas).toEqual(['ok']);
    expect(errors).toEqual([]);
  });
});
