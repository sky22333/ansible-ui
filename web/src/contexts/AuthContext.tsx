import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '@/services/api';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  token: string | null;
}

// 认证存储助手函数
export const authStorage = {
  // 设置认证状态和JWT令牌，包含过期时间（默认5小时）
  setAuth: (value: boolean, token: string | null = null, expiresInHours: number = 5) => {
    if (typeof localStorage !== 'undefined') {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);
      
      localStorage.setItem('isAuthenticated', value ? 'true' : 'false');
      localStorage.setItem('authExpiresAt', expiresAt.toISOString());
      
      // 存储JWT令牌
      if (token) {
        localStorage.setItem('token', token);
      } else if (value === false) {
        localStorage.removeItem('token');
      }
    }
  },
  
  // 获取认证状态，如果已过期则返回false
  getAuth: (): boolean => {
    if (typeof localStorage !== 'undefined') {
      const isAuth = localStorage.getItem('isAuthenticated') === 'true';
      const expiresAt = localStorage.getItem('authExpiresAt');
      
      if (isAuth && expiresAt) {
        // 检查是否过期
        const now = new Date();
        const expiry = new Date(expiresAt);
        
        if (now < expiry) {
          return true;
        } else {
          // 已过期，清除
          authStorage.clearAuth();
        }
      }
    }
    return false;
  },
  
  // 获取JWT令牌
  getToken: (): string | null => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  },
  
  // 清除认证状态
  clearAuth: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('authExpiresAt');
      localStorage.removeItem('token');
    }
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    } catch (error) {
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
