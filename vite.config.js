import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // allow the local pixelcipher host used during dev/testing
  server: {
    allowedHosts: ['local.pixelcipher.online']
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'] // Important: Do not pre-bundle the WebLLM package (large WASM / runtime)
  }
})
