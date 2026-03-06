import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { authPasswordSchema } from '@lucentdocs/shared'
import { trpc } from '@/lib/trpc'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { AuthLayout } from './layout'

// Password strength helpers

type PasswordStrength = 0 | 1 | 2 | 3 | 4

// Levels:
//   0 — empty
//   1 — too short (< 8 chars) — INVALID, fails authPasswordSchema
//   2 — 8+ chars, single character class          = Weak
//   3 — 8+ chars, letters + digits                = Fair
//   4 — 8+ chars, letters + digits + special/long = Strong
function calcPasswordStrength(password: string): PasswordStrength {
  if (!password) return 0
  if (password.length < 8) return 1

  const hasLetter = /[a-zA-Z]/.test(password)
  const hasDigit = /[0-9]/.test(password)
  const hasSpecial = /[^a-zA-Z0-9]/.test(password)
  const isLong = password.length >= 14

  if (!hasLetter || !hasDigit) return 2
  if (hasSpecial || isLong) return 4
  return 3
}

const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: '',
  1: 'Too short',
  2: 'Weak',
  3: 'Fair',
  4: 'Strong',
}

const STRENGTH_COLORS: Record<PasswordStrength, string> = {
  0: 'bg-transparent',
  1: 'bg-destructive',
  2: 'bg-orange-500',
  3: 'bg-amber-400',
  4: 'bg-success',
}

const STRENGTH_LABEL_COLORS: Record<PasswordStrength, string> = {
  0: '',
  1: 'text-destructive',
  2: 'text-orange-500',
  3: 'text-amber-500',
  4: 'text-success',
}

const STRENGTH_WIDTHS: Record<PasswordStrength, string> = {
  0: 'w-0',
  1: 'w-1/4',
  2: 'w-2/4',
  3: 'w-3/4',
  4: 'w-full',
}

function PasswordStrengthBar({ password }: { password: string }) {
  const strength = calcPasswordStrength(password)
  const label = STRENGTH_LABELS[strength]
  const color = STRENGTH_COLORS[strength]
  const labelColor = STRENGTH_LABEL_COLORS[strength]
  const width = STRENGTH_WIDTHS[strength]
  // strength > 1 means the password meets authPasswordSchema (min 8 chars)
  const isValid = strength > 1

  return (
    <div className="grid gap-1.5">
      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color, width)}
          aria-hidden="true"
        />
      </div>

      {/* Label row */}
      <div className="flex items-center justify-between gap-2">
        {label ? <span className={cn('text-xs font-medium', labelColor)}>{label}</span> : <span />}
        <span
          className={cn(
            'flex items-center gap-1 text-xs transition-colors',
            isValid ? 'text-success' : 'text-muted-foreground'
          )}
        >
          <span
            className={cn(
              'inline-block size-1.5 rounded-full shrink-0 transition-colors',
              isValid ? 'bg-success' : 'bg-muted-foreground'
            )}
          />
          At least 8 characters
        </span>
      </div>

      {/* Advisory tips for valid but not-yet-strong passwords */}
      {strength === 2 ? (
        <p className="text-xs text-muted-foreground">
          Mix letters and numbers to strengthen your password.
        </p>
      ) : strength === 3 ? (
        <p className="text-xs text-muted-foreground">
          Add symbols or use 14+ characters to make it stronger.
        </p>
      ) : null}
    </div>
  )
}

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: authPasswordSchema,
})

type SignupFormValues = z.infer<typeof signupSchema>

export function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')?.trim() ?? ''

  const configQuery = trpc.config.get.useQuery()
  const authEnabled = Boolean(configQuery.data?.fields.authEnabled.effectiveValue)
  const invitationQuery = trpc.auth.signupInvitation.useQuery(
    { token: inviteToken },
    {
      enabled: authEnabled && inviteToken.length > 0,
      retry: false,
    }
  )

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  // eslint-disable-next-line react-hooks/incompatible-library
  const passwordValue = watch('password')

  const signupMutation = trpc.auth.signup.useMutation()

  useEffect(() => {
    if (configQuery.isLoading) return
    if (authEnabled) return
    navigate('/', { replace: true })
  }, [authEnabled, configQuery.isLoading, navigate])

  useEffect(() => {
    if (!invitationQuery.data?.email) return
    setValue('email', invitationQuery.data.email)
  }, [invitationQuery.data?.email, setValue])

  const onSubmit = (values: SignupFormValues) => {
    signupMutation.mutate(
      {
        name: values.name,
        email: values.email,
        password: values.password,
        invitationToken: inviteToken,
      },
      {
        onSuccess: () => {
          toast.success('Account created successfully')
          window.location.href = '/'
        },
        onError: (error) => {
          toast.error('Failed to sign up', { description: error.message })
        },
      }
    )
  }

  const isEmailLocked = useMemo(() => Boolean(invitationQuery.data?.email), [invitationQuery.data])

  if (configQuery.isLoading || !authEnabled) {
    return null
  }

  if (!inviteToken) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Invitation required</CardTitle>
            <CardDescription>Ask an admin to generate a signup invitation link.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/login"
                className="text-foreground underline underline-offset-4 hover:opacity-80 transition-opacity"
              >
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  if (invitationQuery.isLoading) {
    return (
      <AuthLayout>
        <p className="text-sm text-muted-foreground animate-pulse">Validating invitation…</p>
      </AuthLayout>
    )
  }

  if (!invitationQuery.data) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Invalid invitation</CardTitle>
            <CardDescription>
              This invitation link is invalid, expired, or already used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Ask an admin for a new invitation link.</p>
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription>Join the workspace via invitation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
            {/* Name */}
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                placeholder="First Last"
                autoComplete="name"
                aria-invalid={Boolean(errors.name)}
                {...register('name')}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            {/* Email */}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isEmailLocked}
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
              {isEmailLocked ? (
                <FieldDescription>This invitation is tied to this email address.</FieldDescription>
              ) : (
                <FieldError errors={[errors.email]} />
              )}
            </Field>

            {/* Password */}
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                placeholder="Create a strong password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
              <FieldError errors={[errors.password]} />
              <PasswordStrengthBar password={passwordValue ?? ''} />
            </Field>

            <Button type="submit" className="w-full mt-1" disabled={signupMutation.isPending}>
              {signupMutation.isPending ? 'Creating account…' : 'Create account'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/login"
                className="text-foreground underline underline-offset-4 hover:opacity-80 transition-opacity"
              >
                Log in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
