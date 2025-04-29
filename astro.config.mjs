// @ts-check
import { defineConfig, envField } from 'astro/config'

import react from '@astrojs/react'
import node from '@astrojs/node'
import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
export default defineConfig({
	integrations: [react()],

	adapter: node({
		mode: 'standalone',
	}),

	output: 'server',

	vite: {
		plugins: [tailwindcss()],
	},

	env: {
		schema: {
			HOST: envField.string({ context: 'server', access: 'public', default: '0.0.0.0' }),
			OPENAI_API_KEY: envField.string({ context: 'server', access: 'secret' }),
		},
	},
})
