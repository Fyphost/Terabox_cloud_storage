import { Agent, request, type Dispatcher } from 'undici';

// One shared dispatcher for all upstream HTTP, tuned for streaming media.
export const upstreamDispatcher: Dispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1, // safer for ranged responses
  connections: 64,
  bodyTimeout: 0, // streams can be long
  headersTimeout: 30_000,
});

export async function upstreamRequest(
  url: string,
  init: Parameters<typeof request>[1] = {},
): ReturnType<typeof request> {
  return request(url, { dispatcher: upstreamDispatcher, ...init });
}
