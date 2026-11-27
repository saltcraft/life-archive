import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  define: {'import.meta.env.VITE_PORTABLE_DEMO': JSON.stringify('0')},
  base: './',
  plugins: [tailwindcss()],
  build: { target: 'es2022', sourcemap: false, modulePreload: false },
})
