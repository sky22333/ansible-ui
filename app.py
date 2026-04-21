from contextlib import contextmanager
from flask import Flask, request, jsonify, send_from_directory, Response
from database import Database
from ansible_manager import AnsibleManager
import json
import os
from functools import wraps
import secrets
from flask_sock import Sock
import paramiko
import threading
import stat
from werkzeug.utils import secure_filename
import time
import hmac
import hashlib
import jwt
import datetime
import logging
from logging.handlers import RotatingFileHandler
from crypto_utils import CryptoUtils, set_crypto_keys, derive_key_from_credentials

def get_client_ip():
    """获取客户端真实IP地址
    优先从代理转发的头信息中获取真实IP，如不存在则返回直连IP
    """
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    return request.remote_addr

app = Flask(__name__, static_folder='public', static_url_path='')
app.secret_key = secrets.token_hex(32)
JWT_EXPIRATION = 5 * 60 * 60  # 5小时，以秒为单位
JWT_SECRET = app.secret_key
db = Database()
ansible = AnsibleManager(db)
crypto = CryptoUtils()

ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')

if not ADMIN_USERNAME or not ADMIN_PASSWORD:
    app.logger.warning("未设置管理员凭证环境变量(ADMIN_USERNAME/ADMIN_PASSWORD)，请设置这些环境变量以确保系统安全")

sock = Sock(app)
sock.init_app(app)

UPLOAD_FOLDER = '/tmp/ansible_uploads'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """检查文件是否允许上传，当前策略是允许所有文件"""
    return True

def handle_error(f):
    """错误处理装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            app.logger.error(f"Error in {f.__name__}: {str(e)}")
            return jsonify({'error': str(e)}), 500
    return decorated_function

def get_request_token():
    """从请求中提取JWT令牌"""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header.split(' ', 1)[1]

    return request.cookies.get('token') or request.args.get('token')

def ensure_crypto_key():
    """确保运行期加密密钥已初始化"""
    from crypto_utils import CRYPTO_KEY

    if isinstance(CRYPTO_KEY, bytes) and len(CRYPTO_KEY) == 32:
        return True

    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        app.logger.error("缺少管理员凭证，无法派生加密密钥")
        return False

    app.logger.info("检测到加密密钥未初始化，尝试从管理员凭证派生")
    try:
        key, salt = derive_key_from_credentials(ADMIN_USERNAME, ADMIN_PASSWORD)
        set_crypto_keys(key, salt)
        app.logger.info("密钥派生成功，长度为: %d 字节", len(key))
        return True
    except Exception as e:
        app.logger.error(f"密钥派生失败: {str(e)}")
        return False

@contextmanager
def ssh_client_for_host(host, timeout=10):
    """为指定主机创建并管理SSH连接"""
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_args = {
        'hostname': host['address'],
        'port': host['port'],
        'username': host['username'],
        'timeout': timeout
    }
    if host['auth_method'] == 'password':
        connect_args['password'] = host['password']

    ssh.connect(**connect_args)
    try:
        yield ssh
    finally:
        ssh.close()

@contextmanager
def sftp_client_for_host(host, timeout=10):
    """为指定主机创建并管理SFTP连接"""
    with ssh_client_for_host(host, timeout=timeout) as ssh:
        with ssh.open_sftp() as sftp:
            yield sftp

def auth_required(f):
    """JWT认证要求装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = get_request_token()
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401

        user = decode_token(token)
        if not user:
            return jsonify({'error': 'Invalid or expired token'}), 401

        if not ensure_crypto_key():
            return jsonify({'error': '系统加密配置错误，请联系管理员'}), 500

        request.user = user
        return f(*args, **kwargs)
    return decorated_function

@app.before_request
def before_request():
    app.logger.info(f"处理请求: {request.path}")

    if request.method == 'OPTIONS':
        return None

@app.after_request
def after_request(response):
    
    if request.path.startswith("/api/"):
        status = 'success' if response.status_code < 400 else 'failed'
        db.add_access_log(
            get_client_ip(),
            request.path, 
            status,
            response.status_code
        )
    return response


@app.route('/api/login', methods=['POST'])
def login():
    """用户登录"""
    data = request.json
    username = data.get('username')
    password = data.get('password')

    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        app.logger.error("系统未配置管理员凭证")
        return jsonify({'success': False, 'message': '系统配置错误'}), 500

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        try:
            key, salt = derive_key_from_credentials(username, password)
            set_crypto_keys(key, salt)
            app.logger.info(f"已从用户凭证成功派生加密密钥，长度为: {len(key)} 字节")
            token = generate_token('admin')
            response_data = {'success': True, 'message': '登录成功', 'token': token}
            response = jsonify(response_data)
            response.set_cookie(
                'token', 
                token, 
                max_age=JWT_EXPIRATION, 
                httponly=True,
                samesite='Lax'
            )
            
            return response
        except Exception as e:
            app.logger.error(f"密钥派生失败: {str(e)}")
            return jsonify({'success': False, 'message': '登录失败，系统加密配置错误'}), 500
    else:
        app.logger.warning(f"登录失败，用户名或密码不正确: {username}")
        return jsonify({'success': False, 'message': '用户名或密码不正确'}), 401


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react_app(path):
    """处理前端路由 - 所有路由都交给React处理，除非是静态文件"""
    app.logger.info(f"serve_react_app 处理 路径: '{path}'")
    
    if path.startswith('terminal'):
        app.logger.info(f"明确处理终端路径: {path}")
        return send_from_directory(app.static_folder, 'index.html')
    
    if path.startswith('api/') or path.startswith('ws/'):
        app.logger.info(f"API或WebSocket路径，返回404: {path}")
        return jsonify({'error': 'Not found'}), 404
    
    static_file_path = os.path.join(app.static_folder, path)
    app.logger.info(f"尝试查找静态文件: {static_file_path}")
    if path != "" and os.path.exists(static_file_path) and not os.path.isdir(static_file_path):
        app.logger.info(f"找到静态文件，返回: {static_file_path}")
        return send_from_directory(app.static_folder, path)
    else:
        app.logger.info(f"未找到静态文件，返回index.html用于前端路由: {path}")
        return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/hosts', methods=['GET'])
@handle_error
@auth_required
def get_hosts():
    """获取所有主机列表"""
    hosts = db.get_hosts()
    for host in hosts:
        if host['auth_method'] == 'password':
            host['is_password_encrypted'] = crypto.is_encrypted(host['encrypted_password'])
        else:
            host['is_password_encrypted'] = False
        host['password'] = '********'
        if 'encrypted_password' in host:
            del host['encrypted_password']
    return jsonify(hosts)

@app.route('/api/hosts/<int:host_id>', methods=['GET'])
@handle_error
@auth_required
def get_host(host_id):
    """获取单个主机信息"""
    host = db.get_host(host_id)
    if host:
        if host['auth_method'] == 'password':
            host['is_password_encrypted'] = crypto.is_encrypted(host['encrypted_password'])
        else:
            host['is_password_encrypted'] = False
        host['password'] = '********'
        if 'encrypted_password' in host:
            del host['encrypted_password']
        return jsonify(host)
    return jsonify({'error': 'Host not found'}), 404

@app.route('/api/hosts', methods=['POST'])
@handle_error
@auth_required
def add_host():
    """添加单个主机"""
    host_data = request.json
    auth_method = host_data.get('auth_method', 'password') # 默认为密码认证

    required_fields = ['comment', 'address', 'username', 'port']
    if auth_method == 'password':
        required_fields.append('password')
    
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    host_id = db.add_host(host_data)
    return jsonify({
        'message': 'Host added successfully',
        'host_id': host_id
    }), 201

@app.route('/api/hosts/batch', methods=['POST'])
@handle_error
@auth_required
def add_hosts_batch():
    """批量添加主机"""
    hosts_data = request.json
    if not isinstance(hosts_data, list):
        return jsonify({'error': 'Invalid data format'}), 400

    for host in hosts_data:
        auth_method = host.get('auth_method', 'password')
        required_fields = ['comment', 'address', 'username', 'port']
        if auth_method == 'password':
            required_fields.append('password')
        
        if not all(field in host for field in required_fields):
            return jsonify({'error': f'Missing required fields in host data: {host}'}), 400

    count = db.add_hosts_batch(hosts_data)
    return jsonify({
        'message': f'Successfully added {count} hosts',
        'count': count
    })

@app.route('/api/hosts/<int:host_id>', methods=['PUT'])
@handle_error
@auth_required
def update_host(host_id):
    """更新主机信息"""
    host_data = request.json

    required_fields = ['comment', 'address', 'username', 'port']
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.update_host(host_id, host_data)
    return jsonify({'message': 'Host updated successfully'})

@app.route('/api/hosts/<int:host_id>', methods=['DELETE'])
@handle_error
@auth_required
def delete_host(host_id):
    """删除主机"""
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.delete_host(host_id)
    return jsonify({'message': 'Host deleted successfully'})

@app.route('/api/execute', methods=['POST'])
@handle_error
@auth_required
def execute_command():
    """执行命令"""
    data = request.json
    command = data.get('command')
    host_ids = data.get('hosts')

    if not command:
        return jsonify({'error': 'Command is required'}), 400

    if host_ids == 'all':
        target_hosts = db.get_hosts()
    else:
        if not isinstance(host_ids, list):
            return jsonify({'error': 'Invalid hosts format'}), 400
        target_hosts = []
        for host_id in host_ids:
            host = db.get_host(host_id)
            if host:
                target_hosts.append(host)
            else:
                return jsonify({'error': f'Host not found: {host_id}'}), 404

    if not target_hosts:
        return jsonify({'error': 'No valid target hosts'}), 400

    results = ansible.execute_command(command, target_hosts)
    return jsonify(results)

@app.route('/api/logs', methods=['GET'])
@handle_error
@auth_required
def get_logs():
    """获取命令执行日志"""
    limit = request.args.get('limit', default=100, type=int)
    logs = db.get_command_logs(limit)
    return jsonify(logs)

@app.route('/api/hosts/<int:host_id>/facts', methods=['GET'])
@handle_error
@auth_required
def get_host_facts(host_id):
    """获取主机详细信息"""
    facts = ansible.get_host_facts(host_id)
    if facts:
        return jsonify(facts)
    return jsonify({'error': 'Failed to get host facts'}), 404

@app.route('/api/hosts/<int:host_id>/ping', methods=['GET'])
@handle_error
@auth_required
def ping_host(host_id):
    """检查主机连通性"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
    
    results = ansible.execute_ping([host])
    host_address = host['address']
    if host_address in results['success']:
        return jsonify({'status': 'success', 'message': '连接正常'})
    elif host_address in results['unreachable']:
        return jsonify({'status': 'unreachable', 'message': '无法连接'})
    else:
        return jsonify({'status': 'failed', 'message': '失败'})

@sock.route('/ws/terminal/<int:host_id>')
def terminal_ws(ws, host_id):
    """处理终端 WebSocket 连接"""
    app.logger.info(f"处理WebSocket连接请求: host_id={host_id}")
    
    token = request.args.get('token')
    if not token:
        app.logger.error("终端WebSocket错误: 未提供令牌")
        ws.send(json.dumps({"error": "Authorization required"}))
        return
    
    try:
        # token 格式: host_id:timestamp:signature
        parts = token.split(':')
        if len(parts) != 3 or parts[0] != str(host_id):
            raise ValueError("Invalid token format")
            
        token_timestamp = int(parts[1])
        current_time = int(time.time())
        if current_time - token_timestamp > 300:  # 5分钟有效期
            raise ValueError("Token expired")
            
        message = f"{host_id}:{token_timestamp}"
        expected_signature = hmac.new(
            app.secret_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        if parts[2] != expected_signature:
            raise ValueError("Invalid token signature")
            
    except Exception:
        app.logger.error("终端WebSocket令牌验证失败")
        ws.send(json.dumps({"error": "Invalid or expired token"}))
        return
    
    host = db.get_host(host_id)
    if not host:
        app.logger.error("终端WebSocket错误: 主机ID不存在")
        ws.send(json.dumps({"error": "Host not found"}))
        return
    
    app.logger.info(f"找到主机信息: id={host_id}")
    
    try:
        with ssh_client_for_host(host, timeout=10) as ssh:
            term_width = 100
            term_height = 30

            app.logger.info("SSH连接成功，创建终端会话")
            channel = ssh.invoke_shell(term='xterm-256color', width=term_width, height=term_height)

            def send_data():
                while True:
                    try:
                        if channel.recv_ready():
                            data = channel.recv(1024).decode('utf-8', errors='ignore')
                            if data:
                                ws.send(data)
                        else:
                            time.sleep(0.1)
                    except Exception:
                        app.logger.error("数据发送错误")
                        break

            thread = threading.Thread(target=send_data)
            thread.daemon = True
            thread.start()

            app.logger.info("WebSocket连接已建立，后台线程已启动")

            welcome_msg = "\r\n\x1b[1;32m*** 已连接到主机 ***\x1b[0m\r\n"
            ws.send(welcome_msg)

            while True:
                try:
                    message = ws.receive()
                    if message is None:
                        app.logger.info("WebSocket连接已关闭")
                        break

                    data = json.loads(message)
                    if data['type'] == 'input':
                        channel.send(data['data'])
                    elif data['type'] == 'resize':
                        new_size = data['data']
                        channel.resize_pty(
                            width=new_size['cols'],
                            height=new_size['rows']
                        )
                except json.JSONDecodeError:
                    app.logger.error("JSON解析错误")
                    continue
                except Exception:
                    app.logger.error("WebSocket接收错误")
                    break
    
    except paramiko.AuthenticationException:
        app.logger.error("SSH认证失败")
        ws.send('\r\n\x1b[1;31m*** SSH认证失败 ***\x1b[0m\r\n')
    except paramiko.SSHException:
        app.logger.error("SSH连接错误")
        ws.send('\r\n\x1b[1;31m*** SSH连接错误 ***\x1b[0m\r\n')
    except Exception:
        app.logger.error("终端连接错误")
        ws.send('\r\n\x1b[1;31m*** 连接错误 ***\x1b[0m\r\n')
    finally:
        app.logger.info("关闭终端连接")
        if 'channel' in locals():
            channel.close()

@app.route('/api/sftp/<int:host_id>/list')
@handle_error
@auth_required
def sftp_list(host_id):
    """获取 SFTP 文件列表"""
    path = request.args.get('path', '/')
    host = db.get_host(host_id)

    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        with sftp_client_for_host(host) as sftp:
            file_list = []
            for entry in sftp.listdir_attr(path):
                file_list.append({
                    'name': entry.filename,
                    'type': 'directory' if stat.S_ISDIR(entry.st_mode) else 'file',
                    'size': entry.st_size,
                    'mtime': entry.st_mtime
                })
            return jsonify(file_list)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/mkdir', methods=['POST'])
@handle_error
@auth_required
def sftp_mkdir(host_id):
    """创建文件夹"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with sftp_client_for_host(host) as sftp:
            try:
                sftp.stat(path)
                return jsonify({'error': 'Directory already exists'}), 400
            except IOError:
                sftp.mkdir(path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP mkdir error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/upload', methods=['POST'])
@handle_error
@auth_required
def sftp_upload(host_id):
    """处理文件上传"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        path = request.form.get('path', '/')
        if not request.files:
            return jsonify({'error': 'No files provided'}), 400

        files = request.files.getlist('files[]')
        
        with sftp_client_for_host(host) as sftp:
            for file in files:
                if file.filename:
                    filename = secure_filename(file.filename)
                    remote_path = os.path.join(path, filename).replace('\\', '/')

                    temp_path = os.path.join('/tmp', filename)
                    file.save(temp_path)

                    try:
                        sftp.put(temp_path, remote_path)
                    finally:
                        if os.path.exists(temp_path):
                            os.remove(temp_path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/rename', methods=['POST'])
@handle_error
@auth_required
def sftp_rename(host_id):
    """重命名文件或文件夹"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        old_path = data.get('old_path')
        new_path = data.get('new_path')
        
        if not old_path or not new_path:
            return jsonify({'error': 'Both old_path and new_path are required'}), 400

        with sftp_client_for_host(host) as sftp:
            try:
                sftp.stat(new_path)
                return jsonify({'error': 'Destination already exists'}), 400
            except IOError:
                sftp.rename(old_path, new_path)

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP rename error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/touch', methods=['POST'])
@handle_error
@auth_required
def sftp_touch(host_id):
    """创建空文件"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with sftp_client_for_host(host) as sftp:
            try:
                sftp.stat(path)
                return jsonify({'error': 'File already exists'}), 400
            except IOError:
                with sftp.file(path, 'w') as f:
                    f.write('')

        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f"SFTP touch error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/read')
@handle_error
@auth_required
def sftp_read(host_id):
    """读取文件内容"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')

    try:
        with sftp_client_for_host(host) as sftp:
            with sftp.file(path, 'r') as f:
                content = f.read().decode('utf-8', errors='replace')
            return jsonify({'content': content})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/write', methods=['POST'])
@handle_error
@auth_required
def sftp_write(host_id):
    """写入文件内容"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        content = data.get('content', '')
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with sftp_client_for_host(host) as sftp:
            with sftp.file(path, 'w') as f:
                f.write(content)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/delete', methods=['POST'])
@handle_error
@auth_required
def sftp_delete(host_id):
    """删除文件或文件夹"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    try:
        data = request.json
        path = data.get('path')
        is_directory = data.get('is_directory', False)
        
        if not path:
            return jsonify({'error': 'Path is required'}), 400

        with sftp_client_for_host(host) as sftp:
            if is_directory:
                if sftp.listdir(path):
                    return jsonify({'error': 'Directory is not empty'}), 400
                sftp.rmdir(path)
            else:
                sftp.remove(path)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/download')
@handle_error
@auth_required
def sftp_download(host_id):
    """下载文件"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')
    if not path:
        return jsonify({'error': 'Path is required'}), 400

    try:
        filename = os.path.basename(path)
        with sftp_client_for_host(host) as sftp:
            file_attr = sftp.stat(path)
            if stat.S_ISDIR(file_attr.st_mode):
                return jsonify({'error': 'Cannot download a directory'}), 400

            # 仅使用文件名，避免目录遍历。
            temp_path = os.path.join('/tmp', secure_filename(filename))
            sftp.get(path, temp_path)

            try:
                with open(temp_path, 'rb') as f:
                    content = f.read()

                response = Response(content)
                response.headers['Content-Type'] = 'application/octet-stream'
                response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
    
    except Exception as e:
        app.logger.error(f"SFTP download error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found_error(error):
    """处理404错误"""
    app.logger.error(f"404错误: 路径={request.path}, IP={request.remote_addr}, 方法={request.method}")
    
    if request.path.startswith('/api/') or request.path.startswith('/ws/'):
        return jsonify({'error': 'Not found'}), 404
    
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/access-logs', methods=['GET'])
@handle_error
@auth_required
def get_access_logs():
    """获取访问日志"""
    limit = request.args.get('limit', default=100, type=int)
    ip_filter = request.args.get('ip', '').strip()
    path_filter = request.args.get('path', '').strip()
    logs = db.get_access_logs(limit=limit, ip_filter=ip_filter, path_filter=path_filter)
    return jsonify(logs)

@app.route('/api/access-logs/cleanup', methods=['POST'])
@handle_error
@auth_required
def cleanup_logs():
    """清理旧日志"""
    db.cleanup_old_logs()
    return jsonify({'message': '已清理3天前的访问日志和命令日志'})

def create_required_directories():
    """创建必要的目录"""
    directories = ['logs', 'data']
    for directory in directories:
        os.makedirs(directory, exist_ok=True)

@app.route('/api/upload', methods=['POST'])
@handle_error
@auth_required
def api_upload():
    """API版本的文件上传处理，适配前端发送的格式，支持部分成功场景"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件被上传'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        remote_path = request.form.get('remote_path', '/tmp/')
        hosts_json = request.form.get('hosts', 'all')
        
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        
        try:
            remote_file_path = os.path.join(remote_path, filename).replace('\\', '/')
            
            if hosts_json != 'all':
                try:
                    hosts = json.loads(hosts_json)
                    if not hosts:
                        return jsonify({'error': '未选择主机'}), 400
                except json.JSONDecodeError:
                    return jsonify({'error': '无效的主机列表格式'}), 400
                
                host_ids = [str(h) for h in hosts]
                all_hosts = db.get_hosts()
                host_map = {str(h['id']): h for h in all_hosts}
                result = ansible.copy_file_to_hosts(file_path, remote_file_path, hosts)
            else:
                all_hosts = db.get_hosts()
                host_map = {str(h['id']): h for h in all_hosts}
                host_ids = list(host_map.keys())
                result = ansible.copy_file_to_all(file_path, remote_file_path)
            
            if os.path.exists(file_path):
                os.remove(file_path)
            
            successful_hosts = []
            failed_hosts = {}
            
            for host, res in result.get('success', {}).items():
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    successful_hosts.append(host_id)
            
            for host, res in result.get('failed', {}).items():
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    failed_hosts[host_id] = res.get('msg', '未知错误')
            
            for host, res in result.get('unreachable', {}).items():
                host_id = next((id for id, h in host_map.items() if h['address'] == host), None)
                if host_id:
                    failed_hosts[host_id] = '主机不可达'
            
            total = len(host_ids)
            succeeded = len(successful_hosts)
            
            if succeeded == total:  # 全部成功
                return jsonify({
                    'success': True,
                    'message': '文件上传成功',
                    'details': {
                        'succeeded': successful_hosts,
                        'failed': {}
                    }
                })
            elif succeeded > 0:  # 部分成功
                return jsonify({
                    'success': True,
                    'message': f'文件部分上传成功 ({succeeded}/{total})',
                    'details': {
                        'succeeded': successful_hosts,
                        'failed': failed_hosts
                    }
                }), 207  # 207 Multi-Status
            else:  # 全部失败
                return jsonify({
                    'success': False,
                    'message': '文件上传失败',
                    'details': {
                        'succeeded': [],
                        'failed': failed_hosts
                    }
                }), 500
                
        except Exception as e:
            app.logger.error(f"文件上传失败: {str(e)}")
            if os.path.exists(file_path):
                os.remove(file_path)
            return jsonify({
                'success': False,
                'message': str(e),
                'details': {
                    'succeeded': [],
                    'failed': {'all': str(e)}
                }
            }), 500
    
    return jsonify({'error': '不支持的文件类型'}), 400

def generate_token(user_id):
    """生成JWT令牌"""
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=JWT_EXPIRATION),
        'iat': datetime.datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def decode_token(token):
    """解码并验证JWT令牌"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def generate_ws_token(host_id):
    """生成用于WebSocket连接的令牌"""
    timestamp = int(time.time())
    message = f"{host_id}:{timestamp}"
    
    signature = hmac.new(
        app.secret_key.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return f"{host_id}:{timestamp}:{signature}"

@app.route('/api/ws-token/<int:host_id>', methods=['GET'])
@auth_required
def get_ws_token(host_id):
    """获取WebSocket连接令牌"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
        
    return jsonify({'token': generate_ws_token(host_id)})

@app.route('/api/playbook/execute', methods=['POST'])
@handle_error
@auth_required
def execute_playbook():
    """执行用户自定义的Ansible Playbook"""
    data = request.json
    playbook_content = data.get('playbook')
    host_ids = data.get('host_ids', [])
    
    if not playbook_content:
        return jsonify({'error': '未提供Playbook内容'}), 400
    
    target_hosts = None
    if host_ids:
        target_hosts = [db.get_host(host_id) for host_id in host_ids]
        target_hosts = [host for host in target_hosts if host]
    
    try:
        result = ansible.execute_custom_playbook(playbook_content, target_hosts)
        
        if target_hosts:
            for host in target_hosts:
                host_status = 'success'
                if host['address'] in result['summary']['failed']:
                    host_status = 'failed'
                elif host['address'] in result['summary']['unreachable']:
                    host_status = 'unreachable'
                
                db.log_command(
                    host['id'],
                    'Custom Playbook Execution',
                    json.dumps({'playbook_logs': result['logs']}),
                    host_status
                )
        else:
            db.log_command(
                None,
                'Custom Playbook Execution',
                json.dumps({'playbook_logs': result['logs']}),
                'success' if result['success'] else 'failed'
            )
        
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Playbook执行错误: {str(e)}")
        return jsonify({'error': f'Playbook执行失败: {str(e)}'}), 500

if __name__ == '__main__':
    create_required_directories()

    file_handler = RotatingFileHandler(
        'logs/app.log',
        maxBytes=1_048_576,
        backupCount=3,
    )
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()
    root_logger.addHandler(file_handler)
    
    app.run(host='0.0.0.0', port=5000)
