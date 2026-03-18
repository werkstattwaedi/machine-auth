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
      const httpsPort = server.config.server.port ?? 5173
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

function hostRewrite(): PluginOption {
  return {
    name: "host-rewrite",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host || req.headers[":authority"]
        if (
          typeof host === "string" &&
          host.startsWith("checkout.werkstattwaedi.ch") &&
          req.url === "/"
        ) {
          res.writeHead(302, { Location: "/checkout" })
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    httpRedirect(),
    hostRewrite(),
    basicSsl(),
    TanStackRouterVite({ quoteStyle: "double" }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    allowedHosts: ["checkout.werkstattwaedi.ch"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
