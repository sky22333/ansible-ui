type AuthMethod = 'password' | 'key';

interface HostPasswordState {
  password?: string;
  auth_method?: AuthMethod;
  is_password_encrypted?: boolean;
}

export const isPasswordEncrypted = (host?: HostPasswordState | null): boolean => {
  return host?.is_password_encrypted === true;
};

export const prepareHostData = <T extends HostPasswordState>(
  hostData: T,
  originalHost?: HostPasswordState,
  useKeyAuth?: boolean,
): T => {
  const preparedData = { ...hostData };
  
  if (useKeyAuth !== undefined) {
    preparedData.auth_method = useKeyAuth ? 'key' : 'password';
  } else if (originalHost && originalHost.auth_method) {
    preparedData.auth_method = originalHost.auth_method;
  } else {
    preparedData.auth_method = 'password';
  }

  // 编辑时保留占位密码，交给后端继续沿用原密码。
  if (originalHost && preparedData.password === '********' && isPasswordEncrypted(originalHost)) {
    delete preparedData.password;
  } else if (preparedData.auth_method === 'key') {
    delete preparedData.password;
  }
  
  return preparedData;
};

