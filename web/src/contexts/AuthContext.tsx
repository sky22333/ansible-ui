import React, { useEffect, useState } from 'react';
import api from '@/services/api';
import { AuthContext } from '@/contexts/auth-context';
import { authStorage } from '@/contexts/auth-storage';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return authStorage.getAuth();
  });
  
  const [token, setToken] = useState<string | null>(() => {
    return authStorage.getToken();
  });
  
  useEffect(() => {
    const checkAuthExpiry = () => {
      const currentAuth = authStorage.getAuth();
      if (isAuthenticated !== currentAuth) {
        setIsAuthenticated(currentAuth);
        if (!currentAuth) {
          setToken(null);
        }
      }
    };
    
    const interval = setInterval(checkAuthExpiry, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await api.post('/api/login', { username, password });
      if (response.data.success) {
        const jwtToken = response.data.token;
        setIsAuthenticated(true);
        setToken(jwtToken);
        authStorage.setAuth(true, jwtToken, 5);
        return true;
      } else {
        setIsAuthenticated(false);
        setToken(null);
        authStorage.clearAuth();
        return false;
      }
    } catch {
      setIsAuthenticated(false);
      setToken(null);
      authStorage.clearAuth();
      return false;
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setToken(null);
    authStorage.clearAuth();
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, token }}>
      {children}
    </AuthContext.Provider>
  );
};
