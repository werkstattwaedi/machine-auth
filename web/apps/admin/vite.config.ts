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
    port: 5174,
    allowedHosts: [process.env.VITE_ADMIN_DOMAIN || "admin.werkstattwaedi.ch"],
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
