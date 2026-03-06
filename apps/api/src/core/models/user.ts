export interface User {
  id: string
  name: string
  email?: string
  role: 'admin' | 'user'
}

export const LOCAL_DEFAULT_USER: User = {
  id: 'local',
  name: 'Local User',
  role: 'admin',
}
