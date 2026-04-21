import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { authStorage } from '@/contexts/auth-storage';

const api = axios.create({
  baseURL: '/',
  withCredentials: true,
});

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

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response && error.response.status === 401) {
      authStorage.clearAuth();
      window.location.href = '/login';
      return Promise.reject(new Error('认证失败，请重新登录'));
    }
    return Promise.reject(error);
  }
);

export default api;
