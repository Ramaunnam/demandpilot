/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Bind IPv4 loopback explicitly: `localhost` resolves to ::1 first on Windows,
  // so the default bind leaves 127.0.0.1 closed and in-editor browsers refuse to connect.
  server: { host: '127.0.0.1', port: 5173 },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
