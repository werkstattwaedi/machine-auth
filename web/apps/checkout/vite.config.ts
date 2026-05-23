import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import basicSsl from "@vitejs/plugin-basic-ssl"

export default defineConfig({
  plugins: [
    basicSsl(),
    TanStackRouterVite({ quoteStyle: "double" }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    allowedHosts: [process.env.VITE_CHECKOUT_DOMAIN || "checkout.werkstattwaedi.ch"],
  },
  // `@oww/shared` is a CJS workspace package (ADR-0027). Vite's default
  // dev-server module loader can't statically extract named exports from
  // CJS modules that use `__exportStar` (TypeScript's compiled
  // `export *` form), causing dev-mode imports like `priceForTier` to
  // resolve to `undefined` and the app to fail to render. Force Vite to
  // pre-bundle `@oww/shared` so esbuild rewrites it to ESM with proper
  // named exports. (Symptom before fix: e2e suite fully red on the
  // wizard's first step — issue #326.)
  optimizeDeps: {
    include: ["@oww/shared"],
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
            return "vendor-react"
          }
          if (id.includes("node_modules/firebase/") || id.includes("node_modules/@firebase/")) {
            return "vendor-firebase"
          }
          if (id.includes("node_modules/@tanstack/")) {
            return "vendor-router"
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
})
