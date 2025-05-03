/**
 * 密码处理工具
 * 
 * 前端不进行实际的加密/解密操作，而是通过识别后端传来的标记决定处理方式
 */

/**
 * 检查密码是否需要重新输入
 * @param host 主机信息
 * @returns 如果密码已加密且未被修改，返回true，否则返回false
 */
export const isPasswordEncrypted = (host: any): boolean => {
  return host && host.is_password_encrypted === true;
};

/**
 * 准备主机数据用于API提交
 * @param hostData 主机表单数据
 * @param originalHost 原始主机数据（编辑时有值）
 * @returns 处理后的主机数据
 */
export const prepareHostData = (hostData: any, originalHost?: any): any => {
  // 复制主机数据
  const preparedData = { ...hostData };
  
  // 如果是编辑模式，且密码为占位符，表示未修改密码
  if (originalHost && preparedData.password === '********' && isPasswordEncrypted(originalHost)) {
    // 不传递密码字段，后端将保留原密码
    delete preparedData.password;
  }
  
  return preparedData;
};

/**
 * 获取密码显示值
 * 对于已加密的密码，显示占位符，否则显示原始值
 * @param host 主机信息
 * @returns 用于显示的密码值
 */
export const getPasswordDisplayValue = (host: any): string => {
  if (!host) return '';
  
  // 如果密码已加密，显示占位符
  if (isPasswordEncrypted(host)) {
    return '********';
  }
  
  // 否则显示原始密码
  return host.password || '';
};

export default {
  isPasswordEncrypted,
  prepareHostData,
  getPasswordDisplayValue,
}; 