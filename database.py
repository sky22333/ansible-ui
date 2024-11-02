# database.py
import sqlite3
from contextlib import contextmanager
import os

class Database:
    def __init__(self, db_path="db/ansible.db"):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """初始化数据库表"""
        with self.get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS hosts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comment TEXT NOT NULL,
                    address TEXT NOT NULL,
                    username TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS command_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    host_id INTEGER,
                    command TEXT NOT NULL,
                    output TEXT,
                    status TEXT NOT NULL,
                    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (host_id) REFERENCES hosts (id)
                )
            """)

    @contextmanager
    def get_connection(self):
        """获取数据库连接的上下文管理器"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()

    def add_host(self, host_data):
        """添加单个主机"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO hosts (comment, address, username, port, password)
                VALUES (?, ?, ?, ?, ?)
            """, (
                host_data['comment'],
                host_data['address'],
                host_data['username'],
                host_data['port'],
                host_data['password']
            ))
            return cursor.lastrowid

    def add_hosts_batch(self, hosts_data):
        """批量添加主机"""
        with self.get_connection() as conn:
            cursor = conn.executemany("""
                INSERT INTO hosts (comment, address, username, port, password)
                VALUES (?, ?, ?, ?, ?)
            """, [(
                host['comment'],
                host['address'],
                host['username'],
                host['port'],
                host['password']
            ) for host in hosts_data])
            return cursor.rowcount

    def get_hosts(self):
        """获取所有主机"""
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM hosts ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]

    def get_host(self, host_id):
        """获取单个主机信息"""
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM hosts WHERE id = ?", (host_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_host(self, host_id, host_data):
        """更新主机信息"""
        with self.get_connection() as conn:
            if host_data.get('password'):  # 如果提供了新密码
                conn.execute("""
                    UPDATE hosts 
                    SET comment = ?, address = ?, username = ?, port = ?, password = ?
                    WHERE id = ?
                """, (
                    host_data['comment'],
                    host_data['address'],
                    host_data['username'],
                    host_data['port'],
                    host_data['password'],
                    host_id
                ))
            else:  # 如果没有提供新密码，保持原密码不变
                conn.execute("""
                    UPDATE hosts 
                    SET comment = ?, address = ?, username = ?, port = ?
                    WHERE id = ?
                """, (
                    host_data['comment'],
                    host_data['address'],
                    host_data['username'],
                    host_data['port'],
                    host_id
                ))

    def delete_host(self, host_id):
        """删除主机"""
        with self.get_connection() as conn:
            conn.execute("DELETE FROM hosts WHERE id = ?", (host_id,))

    def log_command(self, host_id, command, output, status):
        """记录命令执行日志"""
        with self.get_connection() as conn:
            conn.execute("""
                INSERT INTO command_logs (host_id, command, output, status)
                VALUES (?, ?, ?, ?)
            """, (host_id, command, output, status))

    def get_command_logs(self, limit=100):
        """获取命令执行日志"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT cl.*, h.comment, h.address 
                FROM command_logs cl
                LEFT JOIN hosts h ON cl.host_id = h.id
                ORDER BY cl.executed_at DESC
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]