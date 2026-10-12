import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Dev-only: POST /__capture?name=foo with a PNG/JPEG data URL body writes tools/.cache/captures/foo.png.
// Used for real browser-rendered captures (development evidence, the social preview). Not part of the build.
function captureEndpoint(): Plugin {
  return {
    name: 'capture-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'capture').replace(/[^a-z0-9-_]/gi, '');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = join(process.cwd(), 'tools', '.cache', 'captures');
          mkdirSync(dir, { recursive: true });
          const body = Buffer.concat(chunks).toString('utf8');
          const jpeg = body.startsWith('data:image/jpeg;base64,');
          const file = join(dir, `${name}.${jpeg ? 'jpg' : 'png'}`);
          writeFileSync(file, Buffer.from(body.replace(/^data:image\/(png|jpeg);base64,/, ''), 'base64'));
          res.end(file);
        });
      });
      // Dev-only log sink so long browser runs (baseline comparisons, test scenarios) can be saved as evidence.
      server.middlewares.use('/__log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'log').replace(/[^a-z0-9-_.]/gi, '');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = join(process.cwd(), 'tools', '.cache', 'logs');
          mkdirSync(dir, { recursive: true });
          const file = join(dir, name);
          writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  };
}

// Static output with relative URLs so the site works from any sub-path (GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [captureEndpoint()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['mujoco-js'] },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 12000,
    // Keep @license headers (three.js, onnxruntime) in the minified bundle; full texts ship in public/licenses/.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
