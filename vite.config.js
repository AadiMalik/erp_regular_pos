import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import fs from 'fs';
import path from 'path';

function copyPreloadCjs() {
  const source = path.resolve(__dirname, 'electron/preload.cjs');
  const target = path.resolve(__dirname, 'dist-electron/preload.cjs');

  return {
    name: 'copy-preload-cjs',
    buildEnd() {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    copyPreloadCjs(),
    electron([
      {
        entry: 'electron/main.js',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
});
