import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import json
import hashlib

# 全局变量，用于存储加密密钥
CRYPTO_KEY = None
CRYPTO_SALT = None

class CryptoUtils:
    """加密工具类，用于处理密码加密和解密"""
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CryptoUtils, cls).__new__(cls)
            # 初始化
            cls._instance._init_crypto()
        return cls._instance
    
    def _init_crypto(self):
        """初始化加密密钥"""
        global CRYPTO_KEY, CRYPTO_SALT
        
        # 检查全局变量中是否已有密钥
        if CRYPTO_KEY and CRYPTO_SALT:
            # 如果全局变量中有密钥，直接使用
            self.key = CRYPTO_KEY
            self.salt = CRYPTO_SALT
            return
        
        # 没有设置密钥，因为系统依赖用户登录派生密钥
        # 这里设置临时值，将在用户登录时被覆盖
        # 注意：这些临时密钥无法解密任何数据，只是为了避免程序错误
        self.salt = b"temporary_salt_will_be_replaced"
        self.key = os.urandom(32)  # 确保临时密钥也是正确长度：32字节 = 256位
        
        # 将临时密钥存储到全局变量中
        CRYPTO_KEY = self.key
        CRYPTO_SALT = self.salt
    
    def encrypt(self, plain_text):
        """加密明文"""
        if not plain_text:
            return None
            
        # 生成随机nonce
        nonce = os.urandom(12)
        
        # 创建AESGCM对象
        cipher = AESGCM(self.key)
        
        # 加密
        encrypted = cipher.encrypt(nonce, plain_text.encode('utf-8'), None)
        
        # 拼接nonce和加密数据并进行Base64编码
        result = base64.b64encode(nonce + encrypted).decode('utf-8')
        
        # 添加前缀，便于识别此文本是加密的
        return f"ENC:{result}"
    
    def decrypt(self, encrypted_text):
        """解密密文"""
        if not encrypted_text:
            return None
            
        # 检查是否为加密文本
        if not encrypted_text.startswith("ENC:"):
            return encrypted_text
            
        # 去除前缀
        encrypted_text = encrypted_text[4:]
        
        try:
            # Base64解码
            data = base64.b64decode(encrypted_text)
            
            # 提取nonce和密文
            nonce = data[:12]
            ciphertext = data[12:]
            
            # 创建AESGCM对象
            cipher = AESGCM(self.key)
            
            # 解密
            return cipher.decrypt(nonce, ciphertext, None).decode('utf-8')
        except Exception as e:
            # 解密失败则返回原始文本
            print(f"解密失败: {str(e)}")
            return encrypted_text
    
    def is_encrypted(self, text):
        """检查文本是否已加密"""
        return text and isinstance(text, str) and text.startswith("ENC:")

# 设置密钥的函数，允许外部代码设置密钥
def set_crypto_keys(key, salt):
    """设置加密密钥
    
    Args:
        key: 加密密钥，可以是bytes或base64编码的字符串
        salt: 盐值，可以是bytes或base64编码的字符串
    """
    global CRYPTO_KEY, CRYPTO_SALT
    
    # 如果输入是字符串，尝试base64解码
    if isinstance(key, str):
        key = base64.b64decode(key)
    if isinstance(salt, str):
        salt = base64.b64decode(salt)
    
    # 确保密钥长度正确
    if len(key) != 32:
        raise ValueError("AES-GCM密钥必须是256位(32字节)")
        
    CRYPTO_KEY = key
    CRYPTO_SALT = salt

def derive_key_from_credentials(username, password):
    """从用户名和密码派生加密密钥
    
    Args:
        username: 用户名
        password: 密码
    
    Returns:
        tuple: (key, salt) 派生的密钥和盐值
    """
    # 组合用户名和密码作为派生基础
    combined = f"{username}:{password}".encode('utf-8')
    
    # 从用户名派生盐值，确保相同用户名始终生成相同的盐值
    salt = hashlib.sha256(username.encode('utf-8')).digest()[:16]
    
    # 使用PBKDF2派生密钥，确保输出长度为32字节(256位)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 明确指定输出长度为32字节(256位)
        salt=salt,
        iterations=100000,
    )
    key = kdf.derive(combined)
    
    # 确认密钥长度为32字节(256位)
    assert len(key) == 32, "派生的密钥长度必须为256位(32字节)"
    
    return key, salt 