/**
 * 密码处理工具
 * 
 * 前端不进行实际的加密/解密操作，而是通过识别后端传来的标记决定处理方式
 */

type AuthMethod = 'password' | 'key';

interface HostPasswordState {
  password?: string;
  auth_method?: AuthMethod;
  is_password_encrypted?: boolean;
}

/**
 * 检查密码是否需要重新输入
 * @param host 主机信息
 * @returns 如果密码已加密且未被修改，返回true，否则返回false
 */
export const isPasswordEncrypted = (host?: HostPasswordState | null): boolean => {
  return host?.is_password_encrypted === true;
};

/**
 * 准备主机数据用于API提交
 * @param hostData 主机表单数据
 * @param originalHost 原始主机数据（编辑时有值）
 * @param useKeyAuth 是否使用密钥认证（批量添加时传入）
 * @returns 处理后的主机数据
 */
export const prepareHostData = <T extends HostPasswordState>(
  hostData: T,
  originalHost?: HostPasswordState,
  useKeyAuth?: boolean,
): T => {
  // 复制主机数据
  const preparedData = { ...hostData };
  
  // 设置认证方式
  if (useKeyAuth !== undefined) {
    preparedData.auth_method = useKeyAuth ? 'key' : 'password';
  } else if (originalHost && originalHost.auth_method) {
    // 如果是编辑模式且未明确指定useKeyAuth，则保留原有认证方式
    preparedData.auth_method = originalHost.auth_method;
  } else {
    // 默认密码认证
    preparedData.auth_method = 'password';
  }

  // 如果是编辑模式，且密码为占位符，表示未修改密码
  if (originalHost && preparedData.password === '********' && isPasswordEncrypted(originalHost)) {
    // 不传递密码字段，后端将保留原密码
    delete preparedData.password;
  } else if (preparedData.auth_method === 'key') {
    // 如果是密钥认证，则不发送密码字段
    delete preparedData.password;
  }
  
  return preparedData;
};

