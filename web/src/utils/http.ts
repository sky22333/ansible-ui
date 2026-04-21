import { isAxiosError } from 'axios';

interface ApiErrorPayload {
  message?: string;
  error?: string;
}

function readApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as ApiErrorPayload;

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  return null;
}

export function getApiErrorMessage(error: unknown, fallback = '发生未知错误'): string {
  if (isAxiosError<ApiErrorPayload>(error)) {
    const apiMessage = readApiErrorMessage(error.response?.data);
    if (apiMessage) {
      return apiMessage;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
