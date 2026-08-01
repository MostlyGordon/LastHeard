import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "LastHeard — Amateur Radio Digital Voice",
        short_name: "LastHeard",
        description:
          "Live last-heard list for D-STAR digital voice, with area filtering and on-air alarms.",
        display: "standalone",
        orientation: "any",
        background_color: "#0d1117",
        theme_color: "#0d1117",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Don't cache the API; always hit the network for fresh last-heard data.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/lookup/,
            handler: "NetworkFirst",
            options: { cacheName: "lastheard-lookup", expiration: { maxEntries: 500, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
  server: {
    port: 5174,
    host: true,
    strictPort: false,
  },
});