// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  adapter: node({
    mode: 'standalone'
  }),

  vite: {
    plugins: [tailwindcss()]
  }
});