export const authStorage = {
  setAuth: (value: boolean, token: string | null = null, expiresInHours: number = 5) => {
    if (typeof localStorage !== 'undefined') {
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + expiresInHours)

      localStorage.setItem('isAuthenticated', value ? 'true' : 'false')
      localStorage.setItem('authExpiresAt', expiresAt.toISOString())

      if (token) {
        localStorage.setItem('token', token)
      } else if (value === false) {
        localStorage.removeItem('token')
      }
    }
  },

  getAuth: (): boolean => {
    if (typeof localStorage !== 'undefined') {
      const isAuth = localStorage.getItem('isAuthenticated') === 'true'
      const expiresAt = localStorage.getItem('authExpiresAt')

      if (isAuth && expiresAt) {
        const now = new Date()
        const expiry = new Date(expiresAt)

        if (now < expiry) {
          return true
        }

        authStorage.clearAuth()
      }
    }

    return false
  },

  getToken: (): string | null => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('token')
    }

    return null
  },

  clearAuth: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('isAuthenticated')
      localStorage.removeItem('authExpiresAt')
      localStorage.removeItem('token')
    }
  },
}
