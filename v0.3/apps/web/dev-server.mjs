import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const port = Number(process.env.WEB_PORT ?? 5173);
const host = process.env.WEB_HOST ?? '127.0.0.1';
const apiTarget = new URL(process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:18080');
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:18080';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function proxyToApi(req, res) {
  const headers = { ...req.headers, host: apiTarget.host, origin: appOrigin };
  const proxyReq = http.request(
    {
      hostname: apiTarget.hostname,
      port: apiTarget.port || 80,
      path: req.url,
      method: req.method,
      headers
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: `Cannot reach API gateway at ${apiTarget.origin}: ${err.message}`
        }
      })
    );
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0];

  if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) {
    proxyToApi(req, res);
    return;
  }

  let filePath = null;
  if (pathname.startsWith('/packages/ui/')) {
    const candidate = path.resolve(repoRoot, '.' + pathname);
    if (candidate.startsWith(path.join(repoRoot, 'packages/ui'))) {
      filePath = candidate;
    }
  } else if (pathname !== '/' && path.extname(pathname)) {
    const candidate = path.resolve(__dirname, '.' + pathname);
    if (candidate.startsWith(__dirname)) {
      filePath = candidate;
    }
  } else {
    filePath = path.join(__dirname, 'index.html');
  }

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Life Dashboard Web server listening on http://${host}:${port} (API proxy -> ${apiTarget.origin})`);
});
