import http from "http"
import path from "path"
import { defineConfig, type PluginOption } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import basicSsl from "@vitejs/plugin-basic-ssl"

function httpRedirect(): PluginOption {
  return {
    name: "http-redirect",
    configureServer(server) {
      const httpsPort = server.config.server.port ?? 5174
      const httpPort = httpsPort + 1
      http
        .createServer((req, res) => {
          const host = (req.headers.host || "localhost").replace(/:.*/, "")
          res.writeHead(301, {
            Location: `https://${host}:${httpsPort}${req.url}`,
          })
          res.end()
        })
        .listen(httpPort, () => {
          console.log(`  HTTP redirect server listening on port ${httpPort}`)
        })
    },
  }
}

export default defineConfig({
  plugins: [
    httpRedirect(),
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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
})
