import { Hono } from 'hono'
import { notFound, onError, serveEmojiFavicon } from 'stoker/middlewares'
import { MODEL, VOICE } from '~/lib/config'

export const createApp = function() {
	const app = new Hono().basePath('/api')

	app.post('/session', async (c) => {
		const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: MODEL,
				voice: VOICE,
			}),
		})
		return c.json(await r.json())
	})

	app.use(serveEmojiFavicon('🚜'))
	app.notFound(notFound)
	app.onError(onError)
	return app
}

const app = createApp()

export default app
