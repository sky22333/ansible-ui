import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { authStorage } from '@/contexts/AuthContext';

const api = axios.create({
  baseURL: '/', // Assuming the Flask backend serves API at the root
  withCredentials: true, // Important for getting cookies
});

// 添加请求拦截器，为每个请求添加令牌
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = authStorage.getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// 添加响应拦截器来处理潜在的认证错误
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response && error.response.status === 401) {
      // 未授权，清除认证状态
      authStorage.clearAuth(); // 使用authStorage清除认证状态
      
      // 重定向到登录页面
      window.location.href = '/login';
      
      // 返回一个更具描述性的错误
      return Promise.reject(new Error('认证失败，请重新登录'));
    }
    // For other errors, just pass them through
    return Promise.reject(error);
  }
);

export default api;
