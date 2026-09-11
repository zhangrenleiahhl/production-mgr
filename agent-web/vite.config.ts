import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron 生产构建时使用相对路径，浏览器开发时使用绝对路径
const isElectronBuild = process.env.ELECTRON_BUILD === '1';

export default defineConfig({
  plugins: [react()],
  base: isElectronBuild ? './' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  }
});
