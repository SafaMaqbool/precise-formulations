// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://www.preciseformulations.cc",
  output: "server",
  // "compile" optimizes images at build time, so no paid Cloudflare Images usage
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
