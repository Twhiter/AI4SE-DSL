import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The DCR page as a component for other pages (src/dcr-page): one ES module and one stylesheet in dist-component/,
// with React and everything else it needs inside.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      timers: "timers-browserify",
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-component",
    copyPublicDir: false,
    lib: {
      entry: "src/dcr-page/index.tsx",
      formats: ["es"],
      fileName: "dcr-page",
      cssFileName: "dcr-page",
    },
  },
});
