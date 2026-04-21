import React, { useEffect, useState } from 'react';
import api from '@/services/api';
import { AuthContext } from '@/contexts/auth-context';
import { authStorage } from '@/contexts/auth-storage';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    // 初始化时检查本地存储，包括过期时间检查
    return authStorage.getAuth();
  });
  
  const [token, setToken] = useState<string | null>(() => {
    // 初始化时获取存储的令牌
    return authStorage.getToken();
  });
  
  // 定期检查认证状态是否过期
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
    
    // 每分钟检查一次
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
        authStorage.setAuth(true, jwtToken, 5); // 5小时过期
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
