import { Route, createRoutesFromElements } from 'react-router'
import { HomePage } from '@/pages/home'
import { EditorPage } from '@/pages/editor'

export const routes = createRoutesFromElements(
  <>
    <Route path="/" element={<HomePage />} />
    <Route path="/project/:id" element={<EditorPage />} />
  </>
)
