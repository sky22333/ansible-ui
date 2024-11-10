class TerminalManager {
    constructor() {
        this.hostInfo = window.HOST_INFO;
        this.term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                selection: 'rgba(255, 255, 255, 0.3)',
                black: '#000000',
                red: '#e06c75',
                green: '#98c379',
                yellow: '#d19a66',
                blue: '#61afef',
                magenta: '#c678dd',
                cyan: '#56b6c2',
                white: '#ffffff',
            },
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            scrollback: 10000,
            allowTransparency: true,
        });
        
        this.fitAddon = new FitAddon.FitAddon();
        this.term.loadAddon(this.fitAddon);
        
        this.socket = null;
        this.isConnected = false;
        this.currentPath = '/';
        this.editor = null;
        this.currentFile = null;
        
        this.initTerminal();
        this.initFileExplorer();
        this.initEditor();
        this.bindEvents();
        this.connect();
    }

    initTerminal() {
        const terminal = document.getElementById('terminal');
        this.term.open(terminal);
        
        // 设置终端输入处理
        this.term.onData(data => {
            if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({type: 'input', data: data}));
            }
        });
        
        // 初始化完成后调整大小
        setTimeout(() => {
            this.fitAddon.fit();
            this.term.focus();
        }, 100);
    }

    connect() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${this.hostInfo.id}`;
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = () => {
                this.isConnected = true;
                this.updateConnectionStatus(true);
                this.term.clear();
                this.term.write('\r\n\x1b[1;32m*** 连接成功 ***\x1b[0m\r\n');
            };
            
            this.socket.onmessage = (event) => {
                this.term.write(event.data);
            };
            
            this.socket.onclose = () => {
                this.isConnected = false;
                this.updateConnectionStatus(false);
                this.term.write('\r\n\x1b[1;31m*** 连接已关闭 ***\x1b[0m\r\n');
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.term.write('\r\n\x1b[1;31m*** 连接错误 ***\x1b[0m\r\n');
            };
        } catch (error) {
            console.error('Connection error:', error);
            this.term.write('\r\n\x1b[1;31m*** 连接失败 ***\x1b[0m\r\n');
        }
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        const indicator = statusEl.querySelector('.status-indicator');
        
        if (connected) {
            statusEl.innerHTML = `
                <span class="status-indicator status-connected"></span>
                已连接
            `;
        } else {
            statusEl.innerHTML = `
                <span class="status-indicator status-disconnected"></span>
                未连接
            `;
        }
    }

    reconnect() {
        if (this.socket) {
            this.socket.close();
        }
        setTimeout(() => {
            this.connect();
        }, 1000);
    }

    bindEvents() {
        // 窗口大小改变时调整终端大小
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
            this.updateTerminalSize();
        });

        // 绑定工具栏按钮事件
        document.getElementById('clearBtn').onclick = () => {
            this.term.clear();
            this.term.focus();
        };

        document.getElementById('reconnectBtn').onclick = () => {
            this.reconnect();
        };

        // 终端大小改变时通知服务器
        this.term.onResize(dimensions => {
            this.updateTerminalSize();
        });

        // 添加键盘快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl + L 清屏
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.term.clear();
            }
        });
    }

    updateTerminalSize() {
        if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
            const dimensions = {
                cols: this.term.cols,
                rows: this.term.rows
            };
            this.socket.send(JSON.stringify({
                type: 'resize',
                data: dimensions
            }));
        }
    }

    initFileExplorer() {
        this.loadFileList();
        this.initUploadHandlers();
        
        // 绑定文件管理按钮事件
        document.getElementById('toggleExplorer').onclick = () => {
            document.getElementById('fileExplorer').classList.toggle('collapsed');
            setTimeout(() => this.fitAddon.fit(), 300);
        };
        
        document.getElementById('newFolderBtn').onclick = () => this.createNewFolder();
        document.getElementById('newFileBtn').onclick = () => this.createNewFile();
        document.getElementById('uploadBtn').onclick = () => this.showUploadDialog();
    }

    initEditor() {
        this.editor = CodeMirror(document.getElementById('editor'), {
            mode: 'javascript',
            theme: 'monokai',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: true,
            readOnly: false,
            extraKeys: {
                "Ctrl-S": () => this.saveFile(),
                "Esc": () => this.closeEditor()
            }
        });

        document.getElementById('saveFile').onclick = () => this.saveFile();
        document.getElementById('closeEditor').onclick = () => this.closeEditor();
    }

    loadFileList() {
        fetch(`/api/sftp/${this.hostInfo.id}/list?path=${encodeURIComponent(this.currentPath)}`)
            .then(response => response.json())
            .then(data => {
                const fileList = document.getElementById('fileList');
                fileList.innerHTML = '';
                
                // 添加返回上级目录
                if (this.currentPath !== '/') {
                    const backItem = this.createFileItem('..', 'directory');
                    backItem.onclick = () => {
                        this.currentPath = this.currentPath.split('/').slice(0, -1).join('/') || '/';
                        this.loadFileList();
                    };
                    fileList.appendChild(backItem);
                }
                
                // 排序：文件夹在前，文件在后
                const sortedFiles = data.sort((a, b) => {
                    if (a.type === b.type) return a.name.localeCompare(b.name);
                    return a.type === 'directory' ? -1 : 1;
                });
                
                sortedFiles.forEach(item => {
                    const fileItem = this.createFileItem(item.name, item.type);
                    fileList.appendChild(fileItem);
                });

                // 更新当前路径显示
                document.getElementById('currentPath').textContent = this.currentPath;
            })
            .catch(error => console.error('Error loading file list:', error));
    }

    createFileItem(name, type) {
        const item = document.createElement('div');
        item.className = `file-item ${type}`;
        item.innerHTML = `
            <i class="fas fa-${type === 'directory' ? 'folder' : 'file'}"></i>
            <span>${name}</span>
        `;
        
        // 添加点击防抖
        let clickTimeout;
        item.onclick = (e) => {
            // 清除之前的点击计时器
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }
            
            clickTimeout = setTimeout(() => {
                if (type === 'directory') {
                    if (name === '..') {
                        // 返回上级目录
                        this.currentPath = this.currentPath.split('/').slice(0, -1).join('/') || '/';
                    } else {
                        // 进入子目录，确保路径不会重复
                        const newPath = this.currentPath === '/' ? 
                            `/${name}` : `${this.currentPath}/${name}`;
                        // 检查新路径是否与当前路径相同
                        if (this.currentPath !== newPath) {
                            this.currentPath = newPath;
                        }
                    }
                    this.loadFileList();
                } else {
                    this.openFile(name);
                }
            }, 300); // 300ms 的防抖延迟
        };
        
        // 添加右键菜单
        item.oncontextmenu = (e) => {
            e.preventDefault();
            this.showContextMenu(e, name, type);
        };
        
        return item;
    }

    showContextMenu(event, name, type) {
        const existing = document.querySelector('.context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;

        const items = [];
        if (type === 'directory') {
            items.push(
                { label: '删除文件夹', icon: 'trash-alt', action: () => this.deleteItem(name, type) }
            );
        } else {
            items.push(
                { label: '编辑', icon: 'edit', action: () => this.openFile(name) },
                { label: '下载', icon: 'download', action: () => this.downloadFile(name) },
                { label: '删除', icon: 'trash-alt', action: () => this.deleteItem(name, type) }
            );
        }
        items.push(
            { label: '重命名', icon: 'pencil-alt', action: () => this.renameItem(name, type) }
        );

        items.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.innerHTML = `<i class="fas fa-${item.icon}"></i>${item.label}`;
            menuItem.onclick = () => {
                item.action();
                menu.remove();
            };
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        document.addEventListener('click', () => menu.remove(), { once: true });
    }

    // 添加文件管理相关的方法
    initUploadHandlers() {
        const dropzone = document.getElementById('uploadDropzone');
        const fileInput = document.getElementById('fileInput');
        const uploadOverlay = document.getElementById('uploadOverlay');

        // 拖放上传
        dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        };

        dropzone.ondragleave = () => {
            dropzone.classList.remove('dragover');
        };

        dropzone.ondrop = (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        };

        // 点击上传
        dropzone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => this.handleFiles(e.target.files);

        // 上传对话框按钮
        document.getElementById('cancelUpload').onclick = () => {
            uploadOverlay.style.display = 'none';
            // 清除可能存在的进度条
            const progressDiv = uploadOverlay.querySelector('.upload-progress');
            if (progressDiv) {
                progressDiv.remove();
            }
        };

        document.getElementById('confirmUpload').onclick = () => {
            const files = fileInput.files;
            if (files.length > 0) {
                this.uploadFiles(files);
            }
        };
    }

    showUploadDialog() {
        const uploadOverlay = document.getElementById('uploadOverlay');
        const dropzone = document.getElementById('uploadDropzone');
        const fileInput = document.getElementById('fileInput');
        
        // 重置文件输入和显示
        fileInput.value = '';
        const existingList = dropzone.querySelector('.selected-files');
        if (existingList) {
            existingList.remove();
        }
        
        // 重置拖放区域的提示文本
        dropzone.querySelector('p').style.display = 'block';
        
        uploadOverlay.style.display = 'flex';
    }

    handleFiles(files) {
        const fileInput = document.getElementById('fileInput');
        fileInput.files = files;
        
        // 显示已选择的文件列表
        const dropzone = document.getElementById('uploadDropzone');
        const fileList = document.createElement('div');
        fileList.className = 'selected-files';
        fileList.innerHTML = `
            <div class="mt-3 mb-2">已选择的文件：</div>
            <div class="file-list-container">
                ${Array.from(files).map(file => `
                    <div class="selected-file">
                        <i class="fas fa-file me-2"></i>
                        ${file.name}
                        <small class="text-muted ms-2">(${this.formatFileSize(file.size)})</small>
                    </div>
                `).join('')}
            </div>
        `;
        
        // 移除之前的文件列表（如果存在）
        const existingList = dropzone.querySelector('.selected-files');
        if (existingList) {
            existingList.remove();
        }
        
        // 添加新的文件列表
        dropzone.appendChild(fileList);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    uploadFiles(files) {
        const formData = new FormData();
        for (let file of files) {
            formData.append('files[]', file);
        }
        formData.append('path', this.currentPath);

        // 创建进度显示元素
        const progressDiv = document.createElement('div');
        progressDiv.className = 'upload-progress';
        progressDiv.innerHTML = `
            <div class="progress" style="height: 20px; margin: 10px 0;">
                <div class="progress-bar progress-bar-striped progress-bar-animated" 
                     role="progressbar" 
                     style="width: 0%" 
                     aria-valuenow="0" 
                     aria-valuemin="0" 
                     aria-valuemax="100">0%</div>
            </div>
        `;
        
        // 添加进度条到上传对话框
        const uploadDialog = document.querySelector('.upload-dialog');
        uploadDialog.insertBefore(progressDiv, uploadDialog.lastElementChild);

        // 使用 XMLHttpRequest 来实现上传进度
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/sftp/${this.hostInfo.id}/upload`, true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                const progressBar = progressDiv.querySelector('.progress-bar');
                progressBar.style.width = percentComplete + '%';
                progressBar.setAttribute('aria-valuenow', percentComplete);
                progressBar.textContent = percentComplete + '%';
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                const result = JSON.parse(xhr.responseText);
                if (result.success) {
                    document.getElementById('uploadOverlay').style.display = 'none';
                    this.loadFileList();
                } else {
                    alert('上传失败: ' + result.error);
                }
            } else {
                alert('上传失败: ' + xhr.statusText);
            }
            // 移除进度条
            progressDiv.remove();
        };

        xhr.onerror = () => {
            alert('上传失败');
            progressDiv.remove();
        };

        xhr.send(formData);
    }

    openFile(name) {
        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        
        fetch(`/api/sftp/${this.hostInfo.id}/read?path=${encodeURIComponent(path)}`)
            .then(response => response.text())
            .then(content => {
                this.currentFile = path;
                
                // 根据文件扩展名设置编辑器模式
                const extension = name.split('.').pop().toLowerCase();
                const mode = this.getEditorMode(extension);
                this.editor.setOption('mode', mode);
                
                // 显示编辑器并设置内容
                document.getElementById('terminal').style.display = 'none';
                document.getElementById('editor').style.display = 'block';
                this.editor.setValue(content);
                this.editor.refresh();
                
                // 自动调整编辑器大小
                setTimeout(() => this.editor.refresh(), 100);
            })
            .catch(error => {
                console.error('Error reading file:', error);
                alert('无法读取文件');
            });
    }

    getEditorMode(extension) {
        const modeMap = {
            'js': 'javascript',
            'py': 'python',
            'html': 'xml',
            'htm': 'xml',
            'css': 'css',
            'json': 'javascript',
            'md': 'markdown',
            'sh': 'shell',
            'bash': 'shell',
            'txt': 'text'
        };
        return modeMap[extension] || 'text';
    }

    saveFile() {
        if (!this.currentFile) return;
        
        const content = this.editor.getValue();
        
        fetch(`/api/sftp/${this.hostInfo.id}/write`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: this.currentFile,
                content: content
            })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                alert('保存成功');
            } else {
                alert('保存失败: ' + result.error);
            }
        })
        .catch(error => {
            console.error('Save error:', error);
            alert('保存失败');
        });
    }

    closeEditor() {
        this.currentFile = null;
        document.getElementById('editor').style.display = 'none';
        document.getElementById('terminal').style.display = 'block';
        this.term.focus();
        this.fitAddon.fit();
    }

    createNewFolder() {
        const name = prompt('请输入文件夹名称：');
        if (!name) return;

        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        
        fetch(`/api/sftp/${this.hostInfo.id}/mkdir`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                this.loadFileList();
            } else {
                alert('创建文件夹失败: ' + result.error);
            }
        })
        .catch(error => {
            console.error('Create folder error:', error);
            alert('创建文件夹失败');
        });
    }

    createNewFile() {
        const name = prompt('请输入文件名：');
        if (!name) return;

        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        
        fetch(`/api/sftp/${this.hostInfo.id}/touch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                this.loadFileList();
                this.openFile(name);
            } else {
                alert('创建文件失败: ' + result.error);
            }
        })
        .catch(error => {
            console.error('Create file error:', error);
            alert('创建文件失败');
        });
    }

    deleteItem(name, type) {
        if (!confirm(`确定要删除${type === 'directory' ? '文件夹' : '文件'} "${name}" 吗？`)) {
            return;
        }

        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        
        fetch(`/api/sftp/${this.hostInfo.id}/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path,
                type
            })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                this.loadFileList();
            } else {
                alert('删除失败: ' + result.error);
            }
        })
        .catch(error => {
            console.error('Delete error:', error);
            alert('删除失败');
        });
    }

    renameItem(oldName, type) {
        const newName = prompt(`请输入新的${type === 'directory' ? '文件夹' : '文件'}名：`, oldName);
        if (!newName || newName === oldName) return;

        const oldPath = this.currentPath === '/' ? `/${oldName}` : `${this.currentPath}/${oldName}`;
        const newPath = this.currentPath === '/' ? `/${newName}` : `${this.currentPath}/${newName}`;
        
        fetch(`/api/sftp/${this.hostInfo.id}/rename`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                old_path: oldPath,
                new_path: newPath
            })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                this.loadFileList();
            } else {
                alert('重命名失败: ' + result.error);
            }
        })
        .catch(error => {
            console.error('Rename error:', error);
            alert('重命名失败');
        });
    }

    downloadFile(name) {
        const path = this.currentPath === '/' ? `/${name}` : `${this.currentPath}/${name}`;
        window.open(`/api/sftp/${this.hostInfo.id}/download?path=${encodeURIComponent(path)}`);
    }
}

// 等待 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.terminal = new TerminalManager();
}); 