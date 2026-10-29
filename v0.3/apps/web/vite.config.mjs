const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:18080';
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:18080';

export default {
  cacheDir: '../../.runtime/cache/vite',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        headers: {
          Origin: appOrigin
        }
      },
      '/health': {
        target: apiTarget,
        changeOrigin: false
      }
    }
  }
};
