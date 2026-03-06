import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { trpc } from '@/lib/trpc'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { AuthLayout } from './layout'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const loginMutation = trpc.auth.login.useMutation()
  const configQuery = trpc.config.get.useQuery()
  const authEnabled = Boolean(configQuery.data?.fields.authEnabled.effectiveValue)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  useEffect(() => {
    if (configQuery.isLoading) return
    if (authEnabled) return
    navigate('/', { replace: true })
  }, [authEnabled, configQuery.isLoading, navigate])

  const onSubmit = (values: LoginFormValues) => {
    loginMutation.mutate(values, {
      onSuccess: () => {
        toast.success('Logged in successfully')
        window.location.href = '/'
      },
      onError: (error) => {
        toast.error('Failed to log in', { description: error.message })
      },
    })
  }

  if (configQuery.isLoading || !authEnabled) {
    return null
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl">Log in to Plotline</CardTitle>
          <CardDescription>Enter your credentials to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
              <FieldError errors={[errors.email]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
              <FieldError errors={[errors.password]} />
            </Field>

            <Button type="submit" className="w-full mt-1" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
