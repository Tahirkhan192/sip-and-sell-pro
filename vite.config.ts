// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, componentTagger (dev-only),
//     VITE_* env injection, @ path alias, React/TanStack dedupe, error/sandbox plugins.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      mcpPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        strategies: "generateSW",
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: false, // served from public/manifest.webmanifest
        includeAssets: ["favicon.svg", "pwa-192.png", "pwa-512.png", "apple-touch-icon.png", "manifest.webmanifest"],
        workbox: {
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/~oauth/, /^\/\.mcp/, /^\/\.well-known/, /^\/\.lovable/, /^\/api\//],
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff,woff2,ttf,otf,json}"],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // App HTML shell — network first, fall back to cache when offline.
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-shell",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Same-origin hashed build assets.
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ["script", "style", "worker"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "static-assets",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60 },
              },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ["image", "font"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "images-fonts",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            {
              // Google Fonts CSS + files.
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts",
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              // Supabase REST reads — stale-while-revalidate so pages render
              // instantly from cache and refresh in the background.
              urlPattern: /https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
              handler: "StaleWhileRevalidate",
              method: "GET",
              options: {
                cacheName: "supabase-rest",
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Supabase auth session.
              urlPattern: /https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "supabase-auth",
                networkTimeoutSeconds: 5,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  },
});
