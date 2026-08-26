export const FIXTURE_SCENARIOS = Object.freeze({
  clean: { status: 200, chunks: ['0:"Fixture answer"\n', 'd:{"finishReason":"stop"}\n'] },
  delayed: { status: 200, delayMs: 150, chunks: ['0:"Delayed answer"\n', 'd:{"finishReason":"stop"}\n'] },
  empty: { status: 200, chunks: [] },
  malformed: { status: 200, chunks: ['not-valid-sse\n'] },
  partial: { status: 200, chunks: ['0:"Partial answer"\n'], closeEarly: true },
  duplicate: { status: 200, chunks: ['0:"First"\n', '0:"First"\n', 'd:{"finishReason":"stop"}\n'] },
  late: { status: 200, chunks: ['0:"On time"\n', 'd:{"finishReason":"stop"}\n', '0:"Late"\n'] },
  http408: { status: 408, body: 'fixture timeout' },
  http429: { status: 429, body: 'fixture rate limited', headers: { 'retry-after': '1' } },
  http500: { status: 500, body: 'fixture service error' },
  abrupt: { status: 200, chunks: ['0:"Before close"\n'], destroySocket: true },
  crossUserCanary: { status: 200, chunks: ['0:"CANARY_OTHER_USER"\n', 'd:{"finishReason":"stop"}\n'] },
});

export function fixtureScenario(name) {
  const scenario = FIXTURE_SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown fixture scenario: ${name}`);
  return scenario;
}
