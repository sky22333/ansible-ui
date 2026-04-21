import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import hashlib

CRYPTO_KEY = None
CRYPTO_SALT = None

class CryptoUtils:
    """加密工具类，用于处理密码加密和解密"""
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CryptoUtils, cls).__new__(cls)
            cls._instance._init_crypto()
        return cls._instance
    
    def _init_crypto(self):
        """初始化加密密钥"""
        global CRYPTO_KEY, CRYPTO_SALT
        
        if CRYPTO_KEY and CRYPTO_SALT:
            self.key = CRYPTO_KEY
            self.salt = CRYPTO_SALT
            return
        
        # 登录前先放置占位密钥，避免实例初始化失败。
        self.salt = b"temporary_salt_will_be_replaced"
        self.key = os.urandom(32)
        
        CRYPTO_KEY = self.key
        CRYPTO_SALT = self.salt
    
    def encrypt(self, plain_text):
        """加密明文"""
        if not plain_text:
            return None
            
        nonce = os.urandom(12)
        cipher = AESGCM(self.key)
        encrypted = cipher.encrypt(nonce, plain_text.encode('utf-8'), None)
        result = base64.b64encode(nonce + encrypted).decode('utf-8')
        return f"ENC:{result}"
    
    def decrypt(self, encrypted_text):
        """解密密文"""
        if not encrypted_text:
            return None
            
        if not encrypted_text.startswith("ENC:"):
            return encrypted_text
        encrypted_text = encrypted_text[4:]
        
        try:
            data = base64.b64decode(encrypted_text)
            nonce = data[:12]
            ciphertext = data[12:]
            cipher = AESGCM(self.key)
            return cipher.decrypt(nonce, ciphertext, None).decode('utf-8')
        except Exception as e:
            print(f"解密失败: {str(e)}")
            return encrypted_text
    
    def is_encrypted(self, text):
        """检查文本是否已加密"""
        return text and isinstance(text, str) and text.startswith("ENC:")

def set_crypto_keys(key, salt):
    """设置加密密钥
    
    Args:
        key: 加密密钥，可以是bytes或base64编码的字符串
        salt: 盐值，可以是bytes或base64编码的字符串
    """
    global CRYPTO_KEY, CRYPTO_SALT
    
    if isinstance(key, str):
        key = base64.b64decode(key)
    if isinstance(salt, str):
        salt = base64.b64decode(salt)
    
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
    combined = f"{username}:{password}".encode('utf-8')
    salt = hashlib.sha256(username.encode('utf-8')).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = kdf.derive(combined)
    assert len(key) == 32, "派生的密钥长度必须为256位(32字节)"
    
    return key, salt 
