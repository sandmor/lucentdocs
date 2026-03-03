import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { createStaticHandler, createStaticRouter } from 'react-router'
import { routes } from './router.tsx'
import App from './App.tsx'

export async function render(url: string) {
  const handler = createStaticHandler(routes)
  const context = await handler.query(new Request(new URL(url, 'http://localhost')))

  if (context instanceof Response) {
    throw context
  }

  const router = createStaticRouter(handler.dataRoutes, context)

  return {
    html: renderToString(
      <StrictMode>
        <App router={router} />
      </StrictMode>
    ),
    hydrationData: context,
  }
}
