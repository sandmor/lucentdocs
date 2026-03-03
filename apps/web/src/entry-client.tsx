import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { routes } from './router.tsx'
import App from './App.tsx'

const router = createBrowserRouter(routes, {
  hydrationData: (window as any).__staticRouterHydrationData,
})

hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App router={router} />
  </StrictMode>
)
