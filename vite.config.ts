/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs, so the built site works wherever it is served from. GitHub Pages
  // serves this as a project page under /plasmidviewer/, where the default absolute "/" base
  // would point every asset at the domain root and 404.
  base: './',
  plugins: [react()],
  // Pre-bundle the MUI Joy subpaths the app imports so adding one mid-session never triggers
  // an on-the-fly re-optimization (which momentarily loads a second React/emotion copy and
  // logs a transient "Invalid hook call"). A fresh `npm run dev` is unaffected either way.
  optimizeDeps: {
    include: [
      '@mui/joy/styles', '@mui/joy/CssBaseline', '@mui/joy/Box', '@mui/joy/Button',
      '@mui/joy/IconButton', '@mui/joy/ButtonGroup', '@mui/joy/Input', '@mui/joy/Select',
      '@mui/joy/Option', '@mui/joy/Sheet', '@mui/joy/Chip', '@mui/joy/Stack',
      '@mui/joy/Typography',
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
