import { useState } from 'react'
import { RouterProvider, type createBrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { trpc, createTRPCClient } from '@/lib/trpc'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

interface AppProps {
  router: ReturnType<typeof createBrowserRouter>
}

function getThemeFromCookie(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'

  const match = document.cookie.match(/(?:^|;\s*)theme=([^;]*)/)
  if (!match) return 'light'

  try {
    const parsed = decodeURIComponent(match[1])
    return parsed === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function App({ router }: AppProps) {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(() => createTRPCClient())

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme={getThemeFromCookie()}
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

export default App
