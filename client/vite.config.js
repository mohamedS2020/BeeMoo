import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    host: true, // Enable network access
    open: true,
    cors: true,
    // Proxy API requests to backend server
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true // Enable WebSocket proxying
      }
    },
    // Hot Module Replacement configuration
    hmr: {
      overlay: true // Show errors in browser overlay
    }
  },
  build: {
    outDir: 'dist',
    target: 'es2015',
    sourcemap: true, // Enable source maps for debugging
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  preview: {
    port: 3000,
    host: true
  },
  // Development optimizations
  optimizeDeps: {
    include: ['socket.io-client'] // Pre-bundle Socket.io client
  }
});
