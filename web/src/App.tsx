import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import TerminalPage from './pages/TerminalPage';
import { Toaster } from "@/components/ui/sonner"; // Updated import to sonner
import { AuthProvider, useAuth, authStorage } from './contexts/AuthContext';

// Wrapper component to protect routes
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  // 使用authStorage检查认证状态
  const isLocalAuth = authStorage.getAuth();
  
  // 如果上下文或本地存储中有有效的认证，则允许访问
  if (isAuthenticated || isLocalAuth) {
    return <>{children}</>;
  }
  
  // 否则重定向到登录页面
  return <Navigate to="/login" replace />;
}

// Main App component
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Login page route */}
          <Route path="/login" element={<LoginPage />} />
          
          {/* Main page route - protected */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <MainPage />
              </ProtectedRoute>
            }
          />
          
          {/* Terminal page route - 不需要强制认证，改为直接访问，内部API调用会处理认证 */}
          <Route 
            path="/terminal/:hostId"
            element={<TerminalPage />}
          />
          
          {/* Fallback route: Redirect unauthenticated users to login, authenticated users to main */}
          <Route 
            path="*" 
            element={
              <AuthRedirect />
            } 
          />
        </Routes>
      </Router>
      <Toaster richColors /> {/* Use sonner Toaster, added richColors prop */}
    </AuthProvider>
  );
}

// Helper component for the fallback route
function AuthRedirect() {
  const { isAuthenticated } = useAuth();
  const isLocalAuth = authStorage.getAuth();
  
  return (isAuthenticated || isLocalAuth) ? <Navigate to="/" replace /> : <Navigate to="/login" replace />;
}

export default App;
