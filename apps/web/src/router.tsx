import { Route, createRoutesFromElements } from 'react-router'
import { HomePage } from '@/pages/home'
import { EditorPage } from '@/pages/editor'
import { AdminConfigPage } from '@/pages/admin-config'
import { AdminPromptsPage } from '@/pages/admin-prompts'
import { AdminUsersPage } from '@/pages/admin-users'
import { UserSettingsPage } from '@/pages/user-settings'

import { LoginPage } from '@/pages/auth/login'
import { SignupPage } from '@/pages/auth/signup'
import { AuthGuard } from '@/pages/auth/guard'

export const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />

    <Route element={<AuthGuard />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/settings" element={<UserSettingsPage />} />
      <Route path="/admin/config" element={<AdminConfigPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/prompts" element={<AdminPromptsPage />} />
      <Route path="/project/:id" element={<EditorPage />} />
    </Route>
  </>
)
