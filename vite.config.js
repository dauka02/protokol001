import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite SPA. Локальная разработка проксирует /api на `vercel dev` (порт 3000),
// чтобы serverless-функция и фронт работали вместе.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
