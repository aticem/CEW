import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Windows file watching can fail silently in some setups; polling makes changes always apply.
  server: {
    watch: {
      usePolling: true,
      interval: 250,
    },
  },
})
