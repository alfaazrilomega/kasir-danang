import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        name: 'Aplikasi Kasir',
        short_name: 'Kasir',
        description: 'Aplikasi kasir offline-first dengan sync Postgres',
        theme_color: '#5A41E5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'finance'],
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/kasir-config.js'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === '/kasir-config.js',
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
