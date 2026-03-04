import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import type { StaticHandlerContext } from 'react-router'
import { routes } from './router.tsx'
import App from './App.tsx'

type WindowWithHydrationData = Window & {
  __staticRouterHydrationData?: StaticHandlerContext
}

const router = createBrowserRouter(routes, {
  hydrationData: (window as WindowWithHydrationData).__staticRouterHydrationData,
})

hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App router={router} />
  </StrictMode>
)
