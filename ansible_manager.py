import os
import ansible.constants as C
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
        context.CLIARGS = ImmutableDict(
            connection='smart',
            module_path=None,
            forks=10,
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
            line = f"{host['address']} ansible_user={host['username']} "
            line += f"ansible_port={host['port']} ansible_ssh_pass={host['password']} "
            line += "ansible_ssh_common_args='-o StrictHostKeyChecking=no'"
            inventory_content.append(line)

        # 创建临时文件
        fd, inventory_path = tempfile.mkstemp(prefix='ansible_inventory_')
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(inventory_content))
        
        return inventory_path

    def execute_command(self, command, target_hosts=None):
        """执行 Ansible 命令"""
        if target_hosts is None:
            target_hosts = self.db.get_hosts()

        # 生成临时 inventory 文件
        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            # 初始化必要的对象
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            # 创建 play 源数据
            play_source = dict(
                name="Ansible Ad-Hoc",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='shell', args=command))]
            )

            # 创建 play 对象
            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)

            # 创建回调插件对象
            results_callback = ResultCallback()

            # 创建任务队列管理器
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                # 执行 play
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            # 处理结果
            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            # 处理成功的结果
            for host, result in results_callback.host_ok.items():
                results['success'][host] = {
                    'stdout': result._result.get('stdout', ''),
                    'stderr': result._result.get('stderr', ''),
                    'rc': result._result.get('rc', 0)
                }
                # 记录日志
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        command,
                        json.dumps(results['success'][host]),
                        'success'
                    )

            # 处理失败的结果
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

            # 处理不可达的结果
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
            # 清理临时文件
            os.remove(inventory_path)

    def execute_ping(self, target_hosts):
        """执行 Ansible ping 模块"""
        # 生成临时 inventory 文件
        inventory_path = self.generate_inventory(target_hosts)
        
        try:
            # 初始化必要的对象
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=inventory_path)
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            # 创建 play 源数据
            play_source = dict(
                name="Ansible Ping",
                hosts='managed_hosts',
                gather_facts='no',
                tasks=[dict(action=dict(module='ping'))]
            )

            # 创建 play 对象
            play = Play().load(play_source, variable_manager=variable_manager, loader=loader)

            # 创建回调插件对象
            results_callback = ResultCallback()

            # 创建任务队列管理器
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                # 执行 play
                tqm.run(play)
            finally:
                if tqm is not None:
                    tqm.cleanup()

            # 处理结果
            results = {
                'success': {},
                'failed': {},
                'unreachable': {}
            }

            # 处理成功的结果
            for host, result in results_callback.host_ok.items():
                results['success'][host] = result._result
                # 记录日志
                host_id = next((h['id'] for h in target_hosts if h['address'] == host), None)
                if host_id:
                    self.db.log_command(
                        host_id,
                        'ping',
                        json.dumps(result._result),
                        'success'
                    )

            # 处理失败的结果
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

            # 处理不可达的结果
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
            # 清理临时文件
            os.remove(inventory_path)

    def get_host_facts(self, host_id):
        """获取主机详细信息"""
        host = self.db.get_host(host_id)
        if not host:
            return None

        # 执行 setup 模块获取主机信息
        results = self.execute_command('ansible_facts', [host])
        if host['address'] in results['success']:
            return results['success'][host['address']]
        return None

    def run_playbook(self, play):
        """运行 playbook"""
        try:
            # 初始化必要的对象
            loader = DataLoader()
            inventory = InventoryManager(loader=loader, sources=self.generate_inventory(self.db.get_hosts()))
            variable_manager = VariableManager(loader=loader, inventory=inventory)
            
            # 创建回调插件对象
            results_callback = ResultCallback()

            # 创建任务队列管理器
            tqm = None
            try:
                tqm = TaskQueueManager(
                    inventory=inventory,
                    variable_manager=variable_manager,
                    loader=loader,
                    passwords=dict(),
                    stdout_callback=results_callback
                )
                # 执行 play
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
        """复制文件到指定主机"""
        if not isinstance(hosts, list):
            hosts = [hosts]
        
        # 获取选中主机的地址列表
        selected_hosts = []
        all_hosts = self.db.get_hosts()
        for host in all_hosts:
            if str(host['id']) in hosts:  # 注意：hosts 是字符串 ID 列表
                selected_hosts.append(host['address'])
        
        if not selected_hosts:
            raise Exception("没有找到选中的主机")
        
        # 使用选中主机的地址列表创建主机组
        hosts_str = ','.join(selected_hosts)
        
        play = [{
            'name': 'Copy file to selected hosts',
            'hosts': hosts_str,  # 使用逗号分隔的主机地址列表
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Copy file',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        return self.run_playbook(play)

    def copy_file_to_all(self, src, dest):
        """复制文件到所有主机"""
        play = [{
            'name': 'Copy file to all hosts',
            'hosts': 'managed_hosts',
            'gather_facts': 'no',
            'tasks': [{
                'name': 'Copy file',
                'copy': {
                    'src': src,
                    'dest': dest,
                    'mode': '0644'
                }
            }]
        }]
        
        return self.run_playbook(play)