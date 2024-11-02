from flask import Flask, request, jsonify, send_from_directory, Response, render_template
from database import Database
from ansible_manager import AnsibleManager
import json
import os
from functools import wraps

app = Flask(__name__, static_folder='public', static_url_path='/public')
db = Database()
ansible = AnsibleManager(db)

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

@app.route('/')
def index():
    """渲染主页"""
    return send_from_directory('public', 'index.html')

@app.route('/api/hosts', methods=['GET'])
@handle_error
def get_hosts():
    """获取所有主机列表"""
    hosts = db.get_hosts()
    # 出于安全考虑，不返回密码
    for host in hosts:
        host['password'] = '********'
    return jsonify(hosts)

@app.route('/api/hosts/<int:host_id>', methods=['GET'])
@handle_error
def get_host(host_id):
    """获取单个主机信息"""
    host = db.get_host(host_id)
    if host:
        host['password'] = '********'  # 不返回密码
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
@handle_error
def terminal(host_id):
    """渲染终端页面"""
    host = db.get_host(host_id)
    if not host:
        return jsonify({'error': 'Host not found'}), 404
    
    # 不传递密码到前端
    host['password'] = '********'
    return render_template('terminal.html', host=host)

@app.route('/api/hosts/<int:host_id>/facts', methods=['GET'])
@handle_error
def get_host_facts(host_id):
    """获取主机详细信息"""
    facts = ansible.get_host_facts(host_id)
    if facts:
        return jsonify(facts)
    return jsonify({'error': 'Failed to get host facts'}), 404

@app.route('/api/health')
def health_check():
    """健康检查接口"""
    return jsonify({
        'status': 'healthy',
        'database': 'connected' if db else 'disconnected',
        'ansible': 'ready' if ansible else 'not ready'
    })

@app.errorhandler(404)
def not_found_error(error):
    """处理404错误"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    return jsonify({'error': 'Internal server error'}), 500

def create_required_directories():
    """创建必要的目录"""
    directories = ['logs', 'data']
    for directory in directories:
        os.makedirs(directory, exist_ok=True)

if __name__ == '__main__':
    # 创建必要的目录
    create_required_directories()
    
    # 设置日志
    import logging
    logging.basicConfig(
        filename='logs/app.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    )
    
    # 启动应用
    app.run(host='0.0.0.0', port=5000, debug=True)