import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only middleware that serves the SAM.gov proxy at /api/sam during
 * `npm run dev`, mirroring the serverless `api/sam.ts` used in production.
 * Reuses the same core so behavior stays identical.
 */
function samDevProxy(): Plugin {
  return {
    name: 'sam-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/sam', async (req, res) => {
        const { proxySamSearch } = await import('./api/_samProxy');
        const url = new URL(req.url ?? '', 'http://localhost');
        const { status, body } = await proxySamSearch(url.searchParams);
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Expose server-side vars (e.g. SAM_API_KEY) to the dev proxy via process.env.
  // These are NOT prefixed with VITE_, so they never reach the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SAM_API_KEY', 'SAM_BASE']) {
    if (env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), samDevProxy()],
  };
});
