import { Route, createRoutesFromElements } from 'react-router'
import { HomePage } from '@/pages/home'
import { EditorPage } from '@/pages/editor'
import { AdminConfigPage } from '@/pages/admin-config'
import { AdminPromptsPage } from '@/pages/admin-prompts'

export const routes = createRoutesFromElements(
  <>
    <Route path="/" element={<HomePage />} />
    <Route path="/admin/config" element={<AdminConfigPage />} />
    <Route path="/admin/prompts" element={<AdminPromptsPage />} />
    <Route path="/project/:id" element={<EditorPage />} />
  </>
)
