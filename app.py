from flask import Flask, request, jsonify, send_from_directory, Response, render_template, session, redirect, url_for
from database import Database
from ansible_manager import AnsibleManager
import json
import os
from functools import wraps
import secrets
from flask_sock import Sock
import paramiko
import threading
import os
import select
import termios
import struct
import fcntl
import stat
from werkzeug.utils import secure_filename
import time

app = Flask(__name__, static_folder='public', static_url_path='/public')
app.secret_key = secrets.token_hex(32)
db = Database()
ansible = AnsibleManager(db)

ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin')

sock = Sock(app)

UPLOAD_FOLDER = '/tmp/ansible_uploads'
ALLOWED_EXTENSIONS = set()

# 确保上传目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    # 允许所有文件类型
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

@app.before_request
def before_request():
    """检查用户登录状态"""
    if not request.path.startswith(('/public/', '/static/')):
        if request.path != '/api/login' and request.path != '/login' and not session.get('logged_in'):
            return redirect(url_for('login_page'))

@app.after_request
def after_request(response):
    """记录请求完成后的状态"""
    if not request.path.startswith(('/public/', '/static/')):
        status = 'success' if response.status_code < 400 else 'failed'
        db.add_access_log(
            request.remote_addr, 
            request.path, 
            status,
            response.status_code
        )
    return response

@app.route('/login')
def login_page():
    """渲染登录页面"""
    return send_from_directory('templates', 'login.html')

@app.route('/api/login', methods=['POST'])
def login():
    """用户登录"""
    data = request.json
    username = data.get('username')
    password = data.get('password')

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session['logged_in'] = True
        return jsonify({'success': True, 'message': '登录成功'})
    else:
        return jsonify({'success': False, 'message': '用户名或密码错误'})

@app.route('/')
def index():
    """渲染主页"""
    return send_from_directory('public', 'index.html')

@app.route('/api/hosts', methods=['GET'])
@handle_error
def get_hosts():
    """获取所有主机列表"""
    hosts = db.get_hosts()
    for host in hosts:
        host['password'] = '********'
    return jsonify(hosts)

@app.route('/api/hosts/<int:host_id>', methods=['GET'])
@handle_error
def get_host(host_id):
    """获取单个主机信息"""
    host = db.get_host(host_id)
    if host:
        host['password'] = '********'
        return jsonify(host)
    return jsonify({'error': 'Host not found'}), 404

@app.route('/api/hosts', methods=['POST'])
@handle_error
def add_host():
    """添加单个主机"""
    host_data = request.json
    required_fields = ['comment', 'address', 'username', 'port', 'password']
    
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    host_id = db.add_host(host_data)
    return jsonify({
        'message': 'Host added successfully',
        'host_id': host_id
    }), 201

@app.route('/api/hosts/batch', methods=['POST'])
@handle_error
def add_hosts_batch():
    """批量添加主机"""
    hosts_data = request.json
    if not isinstance(hosts_data, list):
        return jsonify({'error': 'Invalid data format'}), 400

    required_fields = ['comment', 'address', 'username', 'port', 'password']
    for host in hosts_data:
        if not all(field in host for field in required_fields):
            return jsonify({'error': f'Missing required fields in host data: {host}'}), 400

    count = db.add_hosts_batch(hosts_data)
    return jsonify({
        'message': f'Successfully added {count} hosts',
        'count': count
    })

@app.route('/api/hosts/<int:host_id>', methods=['PUT'])
@handle_error
def update_host(host_id):
    """更新主机信息"""
    host_data = request.json
    required_fields = ['comment', 'address', 'username', 'port']
    
    if not all(field in host_data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    # 检查主机是否存在
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.update_host(host_id, host_data)
    return jsonify({'message': 'Host updated successfully'})

@app.route('/api/hosts/<int:host_id>', methods=['DELETE'])
@handle_error
def delete_host(host_id):
    """删除主机"""
    # 检查主机是否存在
    if not db.get_host(host_id):
        return jsonify({'error': 'Host not found'}), 404
        
    db.delete_host(host_id)
    return jsonify({'message': 'Host deleted successfully'})

@app.route('/api/execute', methods=['POST'])
@handle_error
def execute_command():
    """执行命令"""
    data = request.json
    command = data.get('command')
    host_ids = data.get('hosts')

    if not command:
        return jsonify({'error': 'Command is required'}), 400

    # 确定目标主机
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

    # 执行命令并获取结果
    results = ansible.execute_command(command, target_hosts)
    return jsonify(results)

@app.route('/api/logs', methods=['GET'])
@handle_error
def get_logs():
    """获取命令执行日志"""
    limit = request.args.get('limit', default=100, type=int)
    logs = db.get_command_logs(limit)
    return jsonify(logs)

@app.route('/terminal/<int:host_id>')
def terminal_page(host_id):
    """渲染终端页面"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
    return render_template('terminal.html', host=host)

@app.route('/api/hosts/<int:host_id>/facts', methods=['GET'])
@handle_error
def get_host_facts(host_id):
    """获取主机详细信息"""
    facts = ansible.get_host_facts(host_id)
    if facts:
        return jsonify(facts)
    return jsonify({'error': 'Failed to get host facts'}), 404

@app.route('/api/hosts/<int:host_id>/ping', methods=['GET'])
@handle_error
def ping_host(host_id):
    """检查主机连通性"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
    
    # 使用 Ansible 执行 ping 模块
    results = ansible.execute_ping([host])
    
    # 解析结果
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
    host = db.get_host(host_id)
    if not host:
        return
    
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(
            host['address'],
            port=host['port'],
            username=host['username'],
            password=host['password']
        )
        
        # 默认终端大小
        term_width = 100
        term_height = 30
        
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
                except Exception as e:
                    print(f"Error in send_data: {str(e)}")
                    break
        
        thread = threading.Thread(target=send_data)
        thread.daemon = True
        thread.start()
        
        while True:
            try:
                message = ws.receive()
                if message is None:
                    break
                    
                data = json.loads(message)
                if data['type'] == 'input':
                    channel.send(data['data'])
                elif data['type'] == 'resize':
                    # 处理终端大小调整
                    new_size = data['data']
                    channel.resize_pty(
                        width=new_size['cols'],
                        height=new_size['rows']
                    )
            except Exception as e:
                print(f"Error in receive: {str(e)}")
                break
    
    except Exception as e:
        app.logger.error(f"Terminal error: {str(e)}")
    finally:
        if 'channel' in locals():
            channel.close()
        if 'ssh' in locals():
            ssh.close()

@app.route('/api/sftp/<int:host_id>/list')
def sftp_list(host_id):
    """获取 SFTP 文件列表"""
    path = request.args.get('path', '/')
    host = db.get_host(host_id)
    
    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
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

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
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
        
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
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

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
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

        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
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
def sftp_read(host_id):
    """读取文件内容"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')

    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                with sftp.file(path, 'r') as f:
                    content = f.read()
                return content

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/write', methods=['POST'])
def sftp_write(host_id):
    """写入文件内容"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    data = request.json
    path = data.get('path')
    content = data.get('content')

    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                with sftp.file(path, 'w') as f:
                    f.write(content)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/delete', methods=['POST'])
def sftp_delete(host_id):
    """删除文件或文件夹"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    data = request.json
    path = data.get('path')
    item_type = data.get('type')

    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                if item_type == 'directory':
                    # 递归删除文件夹
                    ssh.exec_command(f'rm -rf "{path}"')
                else:
                    sftp.remove(path)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sftp/<int:host_id>/download')
def sftp_download(host_id):
    """下载文件"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    path = request.args.get('path')
    filename = os.path.basename(path)

    try:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                host['address'],
                port=host['port'],
                username=host['username'],
                password=host['password']
            )
            
            with ssh.open_sftp() as sftp:
                temp_path = os.path.join('/tmp', filename)
                sftp.get(path, temp_path)

                with open(temp_path, 'rb') as f:
                    content = f.read()
                os.remove(temp_path)

                response = Response(content)
                response.headers['Content-Type'] = 'application/octet-stream'
                response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found_error(error):
    """处理404错误"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/access-logs', methods=['GET'])
@handle_error
def get_access_logs():
    """获取访问日志"""
    logs = db.get_access_logs()
    return jsonify(logs)

@app.route('/api/access-logs/cleanup', methods=['POST'])
@handle_error
def cleanup_logs():
    """清理旧日志"""
    db.cleanup_old_logs()
    return jsonify({'message': '已清理7天前的日志'})

def create_required_directories():
    """创建必要的目录"""
    directories = ['logs', 'data']
    for directory in directories:
        os.makedirs(directory, exist_ok=True)

@app.route('/upload_file', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件被上传'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '没有选择文件'})
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        upload_type = request.form.get('uploadType')
        
        # 保存文件
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        
        try:
            if upload_type == 'selected':
                hosts = json.loads(request.form.get('hosts', '[]'))
                if not hosts:
                    return jsonify({'success': False, 'message': '未选择主机'})
                # 使用 ansible 实例而不是 ansible_manager
                result = ansible.copy_file_to_hosts(file_path, f'/tmp/{filename}', hosts)
            else:
                # 使用 ansible 实例而不是 ansible_manager
                result = ansible.copy_file_to_all(file_path, f'/tmp/{filename}')
            
            # 删除临时文件
            os.remove(file_path)
            
            return jsonify({'success': True, 'message': '文件上传成功'})
        except Exception as e:
            # 确保出错时也删除临时文件
            if os.path.exists(file_path):
                os.remove(file_path)
            return jsonify({'success': False, 'message': str(e)})
    
    return jsonify({'success': False, 'message': '不支持的文件���型'})

if __name__ == '__main__':
    create_required_directories()

    import logging
    logging.basicConfig(
        filename='logs/app.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    )
    
    app.run(host='0.0.0.0', port=5000)
