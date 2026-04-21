import { createContext } from 'react'

export interface AuthContextType {
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  token: string | null
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
