/// <reference types="node" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@algolia-central/chat-central': fileURLToPath(
        new URL('./source/algolia-com/code/runtime/index.ts', import.meta.url),
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  ...(command === 'build'
    ? { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }
    : {}),
  build: {
    lib: {
      entry: fileURLToPath(new URL('./source/algolia-com/entry.ts', import.meta.url)),
      name: 'AlgoliaContentEngagement',
      formats: ['iife'],
      fileName: () => 'content-engagement.js',
    },
    cssCodeSplit: false,
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
