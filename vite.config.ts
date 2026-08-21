// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";

// OFFLINE_BUILD=1 produces the desktop (.exe) bundle that runs on a private
// loopback port inside Electron; the normal build is unchanged.
const offline = process.env.OFFLINE_BUILD === "1";

export default defineConfig({
  ...(offline ? { nitro: { preset: "node-server" as const } } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        // Offline build: every data call is served by the embedded local database.
        {
          find: /^@\/integrations\/supabase\/client$/,
          replacement: new URL("./src/lib/local-db/client.ts", import.meta.url).pathname,
        },
      ],
    },
    optimizeDeps: { exclude: ["@electric-sql/pglite"] },
    plugins: [
      mcpPlugin(),
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: false,
        workbox: {
          navigateFallback: "/",
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/\.mcp\//,
            /^\/\.lovable\//,
            /^\/\.well-known\//,
            /^\/~oauth/,
          ],
          globPatterns: ["**/*.{js,css,html,svg,png,jpg,jpeg,webp,ico,woff,woff2,ttf,otf}"],
          runtimeCaching: [
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "app-navigations",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              urlPattern: ({ url, sameOrigin, request }) =>
                sameOrigin &&
                (request.destination === "style" ||
                  request.destination === "script" ||
                  request.destination === "worker" ||
                  request.destination === "font" ||
                  request.destination === "image") &&
                !url.pathname.startsWith("/api/") &&
                !url.pathname.startsWith("/.mcp/") &&
                !url.pathname.startsWith("/.lovable/") &&
                !url.pathname.startsWith("/.well-known/"),
              handler: "CacheFirst",
              options: {
                cacheName: "app-assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
