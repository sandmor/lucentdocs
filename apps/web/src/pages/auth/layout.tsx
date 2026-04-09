import { cn } from '@/lib/utils'

interface AuthLayoutProps {
  children: React.ReactNode
  className?: string
}

export function AuthLayout({ children, className }: AuthLayoutProps) {
  return (
    <div className={cn('min-h-screen bg-background flex flex-col md:flex-row', className)}>
      {/* Left Panel - Brand/Decorative (40% on desktop, full width on mobile) */}
      <div className="relative hidden md:block md:w-[45%] lg:w-[40%] md:min-h-screen overflow-hidden">
        {/* Base background with enhanced atmospheric gradient */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 120% 80% at 30% 30%, oklch(0.72 0.18 75 / 0.15), transparent 60%),
              radial-gradient(ellipse 100% 60% at 70% 70%, oklch(0.72 0.12 75 / 0.08), transparent 50%),
              var(--background)
            `,
          }}
        />

        {/* Organic decorative blobs */}
        {/* Blob 1: Large amber blob, upper right area */}
        <div
          className="absolute -top-[10%] -right-[20%] w-[80%] h-[70%] opacity-[0.06] blur-3xl"
          style={{
            background: 'oklch(0.72 0.2 75)',
            borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
          }}
        />
        {/* Blob 2: Medium blob, lower left */}
        <div
          className="absolute top-[55%] -left-[15%] w-[60%] h-[50%] opacity-[0.05] blur-3xl"
          style={{
            background: 'oklch(0.72 0.18 75)',
            borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%',
          }}
        />
        {/* Blob 3: Small accent blob, center-right */}
        <div
          className="absolute top-[35%] right-[10%] w-[30%] h-[25%] opacity-[0.04] blur-2xl"
          style={{
            background: 'oklch(0.72 0.15 75)',
            borderRadius: '50% 50% 40% 60% / 50% 40% 60% 50%',
          }}
        />

        {/* Subtle vertical line separator (visible on desktop) */}
        <div className="hidden md:block absolute right-0 top-[10%] bottom-[10%] w-px bg-gradient-to-b from-transparent via-border/40 to-transparent" />

        {/* Brand content - centered vertically */}
        <div className="relative z-10 flex flex-col items-center justify-center h-full px-8 py-12 md:px-12 lg:px-16">
          {/* Wordmark */}
          <div className="flex flex-col items-center gap-4 text-center">
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground/90 auth-brand-enter">
              LucentDocs
            </h1>
            <span className="text-sm md:text-base tracking-[0.2em] uppercase text-muted-foreground auth-tagline-enter">
              Documents, your way
            </span>
          </div>

          {/* Optional: Subtle decorative dots */}
          <div className="mt-12 flex gap-3 opacity-30 auth-dots-enter">
            <span className="w-1.5 h-1.5 rounded-full bg-accent/60" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent/20" />
          </div>
        </div>
      </div>

      {/* Right Panel - Form (60% on desktop, full width on mobile) */}
      <div className="relative flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12 bg-background">
        {/* Mobile brand header (only visible on small screens) */}
        <div className="md:hidden flex flex-col items-center gap-2 mb-8 text-center">
          <span className="font-serif text-2xl font-semibold tracking-tight text-foreground/90">
            LucentDocs
          </span>
          <span className="text-xs tracking-widest uppercase text-muted-foreground">
            Documents, your way
          </span>
        </div>

        {/* Form content */}
        <div className="w-full max-w-sm md:max-w-md lg:max-w-lg auth-form-enter">{children}</div>
      </div>
    </div>
  )
}
