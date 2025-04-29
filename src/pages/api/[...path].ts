import type { APIRoute } from 'astro'
import honoServer from '~/server/app'

// Bind the Hono App Context to the Astro Context
export const ALL: APIRoute = (context) => honoServer.fetch(context.request)
