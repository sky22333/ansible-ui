import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import MainPage from './pages/MainPage';
import TerminalPage from './pages/TerminalPage';
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from './contexts/AuthContext';
import { authStorage } from './contexts/auth-storage';
import { useAuth } from './contexts/use-auth';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const isLocalAuth = authStorage.getAuth();
  if (isAuthenticated || isLocalAuth) {
    return <>{children}</>;
  }
  return <Navigate to="/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <MainPage />
              </ProtectedRoute>
            }
          />
          <Route 
            path="/terminal/:hostId"
            element={<TerminalPage />}
          />
          <Route 
            path="*" 
            element={
              <AuthRedirect />
            } 
          />
        </Routes>
      </Router>
      <Toaster richColors />
    </AuthProvider>
  );
}

function AuthRedirect() {
  const { isAuthenticated } = useAuth();
  const isLocalAuth = authStorage.getAuth();
  
  return (isAuthenticated || isLocalAuth) ? <Navigate to="/" replace /> : <Navigate to="/login" replace />;
}

export default App;
