import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev server proxies every backend route to the FastAPI process on :8000,
// so the frontend can use plain relative paths ("/health", "/ws", ...)
// in both dev and production (where it's served behind the same host).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8000',
      '/config': 'http://localhost:8000',
      '/trip': 'http://localhost:8000',
      '/mjpeg': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
