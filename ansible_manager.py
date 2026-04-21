import os
from ansible.parsing.dataloader import DataLoader
from ansible.inventory.manager import InventoryManager
from ansible.vars.manager import VariableManager
from ansible.playbook.play import Play
from ansible.executor.task_queue_manager import TaskQueueManager
from ansible.plugins.callback import CallbackBase
from ansible import context
from ansible.module_utils.common.collections import ImmutableDict
import tempfile
import json
import subprocess
import threading
import re
from crypto_utils import CryptoUtils

class ResultCallback(CallbackBase):
    """自定义回调类来处理任务结果"""
    def __init__(self):
        super().__init__()
        self.host_ok = {}
        self.host_unreachable = {}
        self.host_failed = {}

    def v2_runner_on_ok(self, result):
        self.host_ok[result._host.get_name()] = result

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self.host_failed[result._host.get_name()] = result

    def v2_runner_on_unreachable(self, result):
        self.host_unreachable[result._host.get_name()] = result

class AnsibleManager:
    def __init__(self, db):
        self.db = db
        self.crypto = CryptoUtils()
        context.CLIARGS = ImmutableDict(
            connection='smart',
            module_path=None,
            forks=30,
            become=None,
            become_method=None,
            become_user=None,
            check=False,
            diff=False,
            verbosity=0
        )

    def generate_inventory(self, hosts):
        """生成临时 inventory 文件"""
        inventory_content = ["[managed_hosts]"]
        for host in hosts:
            line = f"{host['address']} ansible_user={host['username']} ansible_port={host['port']} "
            
            if host['auth_method'] == 'key':
                line += "ansible_ssh_private_key_file=/root/.ssh/id_ed25519 "
            elif host['auth_method'] == 'password':
                password = host.get('password')
                if password:
                    line += f"ansible_ssh_pass={password} "

            line += "ansible_ssh_common_args='-o StrictHostKeyChecking=no'"
            inventory_content.append(line)

        fd, inventory_path = tempfile.mkstemp(prefix='ansible_inventory_')
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(inventory_content))
        
        return inventory_path

    def execute_command(self, command, target_hosts=None):
        """执行 Ansible 命令"""
        if target_hosts is None:
            target_hosts = self.db.get_hosts()

        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            play_source = dict(
                name="Ansible Ad-Hoc",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='shell', args=command))]
            )

            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)
            results_callback = ResultCallback()

            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            for host, result in results_callback.host_ok.items():
                results['success'][host] = {
                    'stdout': result._result.get('stdout', ''),
                    'stderr': result._result.get('stderr', ''),
                    'rc': result._result.get('rc', 0)
                }
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['success'][host]),
                        'success'
                    )

            for host, result in results_callback.host_failed.items():
                results['failed'][host] = {
                    'msg': result._result.get('msg', ''),
                    'rc': result._result.get('rc', 1)
                }
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['failed'][host]),
                        'failed'
                    )

            for host, result in results_callback.host_unreachable.items():
                results['unreachable'][host] = {
                    'msg': result._result.get('msg', '')
                }
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['unreachable'][host]),
                        'unreachable'
                    )

            return results

        finally:
            os.remove(inventory_path)

    def execute_ping(self, target_hosts):
        """执行 Ansible ping 模块"""
        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            play_source = dict(
                name="Ansible Ping",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='ping'))]
            )

            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)
            results_callback = ResultCallback()

            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            for host, result in results_callback.host_ok.items():
                results['success'][host] = result._result
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'success'
                    )

            for host, result in results_callback.host_failed.items():
                results['failed'][host] = result._result
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'failed'
                    )

            for host, result in results_callback.host_unreachable.items():
                results['unreachable'][host] = result._result
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'unreachable'
                    )

            return results

        finally:
            os.remove(inventory_path)

    def get_host_facts(self, host_id):
        """获取主机详细信息"""
        host = self.db.get_host(host_id)
        if not host:
            return None

        results = self.execute_command('ansible_facts', [host])
        if host['address'] in results['success']:
            return results['success'][host['address']]
        return None

    def run_playbook(self, play, target_hosts=None):
        """运行 playbook"""
        try:
            loader = DataLoader()
            
            if target_hosts:
                inventory_path = self.generate_inventory(target_hosts)
            else:
                inventory_path = self.generate_inventory(self.db.get_hosts())

            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            results_callback = ResultCallback()

            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                for play_item in play:
                    play_obj = Play().load(play_item, variable_manager=variable_manager, loader=loader)
                    tqm.run(play_obj)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            return {
                'success': results_callback.host_ok,
                'failed': results_callback.host_failed,
                'unreachable': results_callback.host_unreachable
            }
        except Exception as e:
            raise Exception(f"执行 playbook 失败: {str(e)}")

    def copy_file_to_hosts(self, src, dest, hosts):
        """复制文件到指定主机，返回详细的成功/失败结果"""
        if not isinstance(hosts, list):
            hosts = [hosts]
        
        selected_hosts_data = []
        all_hosts = self.db.get_hosts()
        for host in all_hosts:
            host_id_str = str(host['id'])
            if host_id_str in [str(h) for h in hosts]:
                selected_hosts_data.append(host)
        
        if not selected_hosts_data:
            raise Exception("没有找到选中的主机")
        
        hosts_str = ','.join([h['address'] for h in selected_hosts_data])
        
        play = [{
            'name': 'Copy file to selected hosts',
            'hosts': hosts_str,
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Ensure destination directory exists',
                'file': {
                    'path': os.path.dirname(dest),
                    'state': 'directory',
                    'mode': '0755'
                }
            }, {
                'name': 'Copy file to remote hosts',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        try:
            result = self.run_playbook(play, target_hosts=selected_hosts_data)
            return result
        except Exception as e:
            raise Exception(f"复制文件失败: {str(e)}")

    def copy_file_to_all(self, src, dest):
        """复制文件到所有主机，返回详细的成功/失败结果"""
        all_hosts = self.db.get_hosts()
        play = [{
            'name': 'Copy file to all hosts',
            'hosts': 'all',
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Ensure destination directory exists',
                'file': {
                    'path': os.path.dirname(dest),
                    'state': 'directory',
                    'mode': '0755'
                }
            }, {
                'name': 'Copy file to remote hosts',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        try:
            result = self.run_playbook(play, target_hosts=all_hosts)
            return result
        except Exception as e:
            raise Exception(f"复制文件失败: {str(e)}")

    def execute_custom_playbook(self, playbook_content, target_hosts=None):
        """执行自定义Playbook"""
        fd, playbook_path = tempfile.mkstemp(prefix='ansible_playbook_', suffix='.yml')
        with os.fdopen(fd, 'w') as f:
            f.write(playbook_content)
        
        try:
            inventory_option = []
            if target_hosts:
                inventory_path = self.generate_inventory(target_hosts)
                inventory_option = ['-i', inventory_path]
            
            cmd = ['ansible-playbook', playbook_path] + inventory_option + ['-v']
            logs = []
            log_lock = threading.Lock()
            
            def process_output(process):
                for line in iter(process.stdout.readline, b''):
                    decoded_line = line.decode('utf-8').rstrip()
                    with log_lock:
                        logs.append(decoded_line)
            
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=False
            )
            
            output_thread = threading.Thread(target=process_output, args=(process,))
            output_thread.daemon = True
            output_thread.start()
            
            process.wait()
            output_thread.join()
            result = {
                'success': process.returncode == 0,
                'return_code': process.returncode,
                'logs': logs,
                'summary': self._parse_playbook_result(logs)
            }
            
            return result
        
        finally:
            os.remove(playbook_path)
            if target_hosts:
                os.remove(inventory_path)
    
    def _parse_playbook_result(self, logs):
        """解析Playbook执行结果，生成主机成功/失败统计"""
        summary = {
            'success': [],
            'failed': [],
            'unreachable': []
        }
        
        success_pattern = re.compile(r'([\w\.-]+)\s+:\s+ok=\d+')
        failed_pattern = re.compile(r'([\w\.-]+)\s+:\s+.*failed=([1-9]\d*)')
        unreachable_pattern = re.compile(r'([\w\.-]+)\s+:\s+.*unreachable=([1-9]\d*)')
        
        for line in logs:
            success_match = success_pattern.search(line)
            if success_match and not failed_pattern.search(line) and not unreachable_pattern.search(line):
                host = success_match.group(1)
                if host not in summary['success']:
                    summary['success'].append(host)
            
            failed_match = failed_pattern.search(line)
            if failed_match:
                host = failed_match.group(1)
                if host not in summary['failed']:
                    summary['failed'].append(host)
            
            unreachable_match = unreachable_pattern.search(line)
            if unreachable_match:
                host = unreachable_match.group(1)
                if host not in summary['unreachable']:
                    summary['unreachable'].append(host)
        
        return summary
