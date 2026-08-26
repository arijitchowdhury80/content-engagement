import http from 'node:http';
import { once } from 'node:events';

import { fixtureScenario } from './scenarios.mjs';

const PAGE = `<!doctype html>
<html><body>
  <label>Scenario <input id="scenario" value="clean"></label>
  <button id="submit">Submit</button>
  <button id="cancel">Cancel</button>
  <div id="status" data-terminal="false">ready</div>
  <div id="answer"></div>
  <script>
    let controller;
    let submissions = 0;
    document.querySelector('#submit').addEventListener('click', async () => {
      if (controller) return;
      controller = new AbortController();
      submissions += 1;
      document.querySelector('#status').textContent = 'loading';
      document.querySelector('#status').dataset.terminal = 'false';
      try {
        const response = await fetch('/completions', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({scenario: document.querySelector('#scenario').value, submissions}),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('HTTP_' + response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          raw += decoder.decode(next.value, {stream: true});
        }
        const chunks = [];
        for (const line of raw.split('\\n')) {
          if (!line.startsWith('0:')) continue;
          try { chunks.push(JSON.parse(line.slice(2))); } catch {}
        }
        document.querySelector('#answer').textContent = chunks.join('');
        document.querySelector('#status').textContent = raw.includes('d:') ? 'success' : 'stream-interrupted';
      } catch (error) {
        document.querySelector('#status').textContent = error.name === 'AbortError' ? 'cancelled' : error.message;
      } finally {
        document.querySelector('#status').dataset.terminal = 'true';
        controller = null;
      }
    });
    document.querySelector('#cancel').addEventListener('click', () => controller?.abort());
    window.fixtureState = () => ({submissions, status: document.querySelector('#status').textContent});
  </script>
</body></html>`;

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function startFixtureServer({ host = '127.0.0.1' } = {}) {
  const physicalRequests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.local');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(PAGE);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/completions') {
      let body;
      try { body = await readJson(request); } catch {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('invalid fixture request');
        return;
      }
      physicalRequests.push({ at: Date.now(), scenario: body.scenario, submissions: body.submissions });
      const scenario = fixtureScenario(body.scenario);
      if (scenario.headers) for (const [name, value] of Object.entries(scenario.headers)) response.setHeader(name, value);
      if (scenario.status !== 200) {
        response.writeHead(scenario.status, { 'content-type': 'text/plain' });
        response.end(scenario.body ?? 'fixture error');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      if (scenario.delayMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
      for (const chunk of scenario.chunks ?? []) response.write(chunk);
      if (scenario.destroySocket) {
        response.socket?.destroy();
        return;
      }
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, host);
  await once(server, 'listening');
  const address = server.address();
  const origin = `http://${host}:${address.port}`;
  return {
    origin,
    physicalRequests,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}
