$(document).ready(function() {
    $('.navbar-brand').append(`
        <button class="btn btn-outline-light btn-sm ms-3" style="padding: 0.15rem 0.35rem; font-size: 0.75rem;" id="showLogs">
            <i class="fas fa-history fa-sm"></i> 访问日志
        </button>
        
        <!-- 日志弹窗 -->
        <div id="logsModal" class="modal custom-modal">
            <div class="modal-content logs-modal-content">
                <div class="modal-header">
                    <h2 style="margin: 0; color: #333; font-size: 1.2rem;">
                        <i class="fas fa-history"></i> 系统访问日志
                    </h2>
                    <span class="close" title="关闭">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="d-flex gap-2 mb-3">
                        <button class="btn btn-outline-dark btn-sm" id="cleanupLogs">
                            <i class="fas fa-broom"></i> 清理7天前的日志
                        </button>
                        <div class="flex-grow-1 d-flex gap-2">
                            <input type="text" class="form-control form-control-sm" id="logSearchIP" placeholder="搜索IP">
                            <input type="text" class="form-control form-control-sm" id="logSearchPath" placeholder="搜索路径">
                            <button class="btn btn-outline-primary btn-sm" id="searchLogs">
                                <i class="fas fa-search"></i> 搜索
                            </button>
                            <button class="btn btn-outline-secondary btn-sm" id="resetSearch">
                                <i class="fas fa-undo"></i> 重置
                            </button>
                        </div>
                    </div>
                    <div class="table-container">
                        <table class="table table-striped table-hover">
                            <thead class="table-dark">
                                <tr>
                                    <th>访问时间</th>
                                    <th>IP地址</th>
                                    <th>访问路径</th>
                                    <th>状态码</th>
                                </tr>
                            </thead>
                            <tbody id="logsTableBody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `);

    function loadAccessLogs(ipFilter = '', pathFilter = '') {
        $.get('/api/access-logs', function(logs) {
            const tbody = $('#logsTableBody');
            tbody.empty();
            
            logs.filter(log => {
                return (ipFilter === '' || log.ip_address.includes(ipFilter)) &&
                       (pathFilter === '' || log.path.includes(pathFilter));
            }).forEach(function(log) {
                const date = new Date(log.access_time);
                const time = new Date(date.getTime()).toLocaleString('zh-CN', { 
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                
                const statusClass = log.status_code === 200 ? 'text-success' : 'text-dark';
                
                tbody.append(`
                    <tr>
                        <td>${time}</td>
                        <td>${log.ip_address}</td>
                        <td>${log.path}</td>
                        <td>
                            <span class="${statusClass}">
                                ${log.status_code}
                            </span>
                        </td>
                    </tr>
                `);
            });
        });
    }

    $('#searchLogs').click(function() {
        const ipFilter = $('#logSearchIP').val().trim();
        const pathFilter = $('#logSearchPath').val().trim();
        loadAccessLogs(ipFilter, pathFilter);
    });

    $('#resetSearch').click(function() {
        $('#logSearchIP').val('');
        $('#logSearchPath').val('');
        loadAccessLogs();
    });

    $('#showLogs').click(function() {
        loadAccessLogs();
        document.getElementById('logsModal').style.display = "block";
    });

    $(document).on('click', '#logsModal .close', function() {
        document.getElementById('logsModal').style.display = "none";
    });

    $(window).click(function(event) {
        const logsModal = document.getElementById('logsModal');
        if (event.target == logsModal) {
            logsModal.style.display = "none";
        }
    });

    $('#cleanupLogs').click(function() {
        if (confirm('确定要清理7天前的日志吗？')) {
            $.post('/api/access-logs/cleanup', function(response) {
                alert(response.message);
                loadAccessLogs();
            });
        }
    });

    function loadHosts() {
        $.get('/api/hosts', function(data) {
            $('#hostTable tbody').empty();
            $('#hostSelect').empty();
            
            data.forEach(function(host) {
                $('#hostTable tbody').append(`
                    <tr>
                        <td>${host.comment}</td>
                        <td>${host.address}</td>
                        <td>${host.username}</td>
                        <td>${host.port}</td>
                        <td>
                            <button class="btn btn-sm btn-primary edit-host" data-id="${host.id}">编辑</button>
                            <button class="btn btn-sm btn-danger delete-host" data-id="${host.id}">删除</button>
                            <button class="btn btn-sm btn-success check-host" data-id="${host.id}">Ping</button>
                            <button class="btn btn-sm btn-info open-terminal" data-id="${host.id}">终端</button>
                            <span class="health-status" id="health-${host.id}"></span>
                        </td>
                    </tr>
                `);
                
                $('#hostSelect').append(`
                    <option value="${host.id}">${host.comment} (${host.address})</option>
                `);
            });
        });
    }

    function validateHostInput(input) {
        const lines = input.trim().split('\n');
        const errors = [];
        
        lines.forEach((line, index) => {
            if (line.trim() === '') return;
            const parts = line.trim().split(/\s+/);
            if (parts.length !== 5) {
                errors.push(`第${index + 1}行：需要5个参数（备注 地址 用户名 端口 密码），实际得到${parts.length}个参数`);
            }
        });
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    $('#addHosts').click(function() {
        const inputText = $('#batchInput').val();
        if (!inputText.trim()) {
            addLog('请输入主机信息', 'error');
            return;
        }

        const validation = validateHostInput(inputText);
        if (!validation.isValid) {
            validation.errors.forEach(error => {
                addLog(error, 'error');
            });
            return;
        }

        const $addButton = $('#addHosts');
        $addButton.prop('disabled', true).text('添加中');

        const hostsData = inputText.split('\n').map(line => {
            const [comment, address, username, port, password] = line.trim().split(/\s+/);
            return { comment, address, username, port, password };
        }).filter(host => host.address);

        $.ajax({
            url: '/api/hosts/batch',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(hostsData),
            success: function() {
                $('#batchInput').val('');
                loadHosts();
                addLog('成功添加主机', 'success');
            },
            error: function(xhr) {
                addLog('添加主机失败: ' + xhr.responseText, 'error');
            },
            complete: function() {
                $addButton.prop('disabled', false).text('添加主机');
            }
        });
    });

    $(document).on('click', '.delete-host', function() {
        const hostId = $(this).data('id');
        if (confirm('确定要删除这台主机吗？')) {
            $.ajax({
                url: '/api/hosts/' + hostId,
                method: 'DELETE',
                success: function() {
                    loadHosts();
                    addLog('成功删除主机', 'success');
                },
                error: function(xhr) {
                    addLog('删除主机失败: ' + xhr.responseText, 'error');
                }
            });
        }
    });

    $(document).on('click', '.edit-host', function() {
        const hostId = $(this).data('id');
        $.get('/api/hosts/' + hostId, function(host) {
            $('#editHostId').val(host.id);
            $('#editHostComment').val(host.comment);
            $('#editHostAddress').val(host.address);
            $('#editHostUsername').val(host.username);
            $('#editHostPort').val(host.port);
            $('#editHostPassword').val('');
            document.getElementById('editHostModal').style.display = "block";
        });
    });

    $(document).on('click', '#editHostModal .close, .close-edit', function() {
        document.getElementById('editHostModal').style.display = "none";
    });

    $(window).click(function(event) {
        const editModal = document.getElementById('editHostModal');
        if (event.target == editModal) {
            editModal.style.display = "none";
        }
    });

    $('#saveHostEdit').click(function() {
        const hostData = {
            id: $('#editHostId').val(),
            comment: $('#editHostComment').val(),
            address: $('#editHostAddress').val(),
            username: $('#editHostUsername').val(),
            port: $('#editHostPort').val(),
            password: $('#editHostPassword').val()
        };

        $.ajax({
            url: '/api/hosts/' + hostData.id,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(hostData),
            success: function() {
                document.getElementById('editHostModal').style.display = "none";
                loadHosts();
                addLog('成功更新主机信息', 'success');
            },
            error: function(xhr) {
                addLog('更新主机失败: ' + xhr.responseText, 'error');
            }
        });
    });

    $(document).on('click', '.check-host', function() {
        const hostId = $(this).data('id');
        const statusSpan = $(`#health-${hostId}`);
        
        statusSpan.text(' 检查中...');
        
        $.ajax({
            url: `/api/hosts/${hostId}/ping`,
            method: 'GET',
            success: function(response) {
                if (response.status === 'success') {
                    statusSpan.text(' 连接正常');
                    statusSpan.css('color', 'green');
                } else if (response.status === 'unreachable') {
                    statusSpan.text(' 无法连接');
                    statusSpan.css('color', 'red');
                } else {
                    statusSpan.text(' 失败');
                    statusSpan.css('color', 'orange');
                }
            },
            error: function() {
                statusSpan.text(' 检查失败');
                statusSpan.css('color', 'red');
            }
        });
    });

    $('#sendSingle').click(function() {
        const command = $('#commandInput').val();
        const selectedHosts = $('#hostSelect').val();
        
        if (!command) {
            addLog('请输入命令', 'error');
            return;
        }
        if (selectedHosts.length === 0) {
            addLog('请选择目标主机', 'error');
            return;
        }

        $('#sendSingle').prop('disabled', true);
        $('#sendAll').prop('disabled', true);

        executeCommand(command, selectedHosts).always(function() {
            $('#sendSingle').prop('disabled', false);
            $('#sendAll').prop('disabled', false);
        });
    });

    $('#sendAll').click(function() {
        const command = $('#commandInput').val();
        if (!command) {
            addLog('请输入命令', 'error');
            return;
        }

        $('#sendSingle').prop('disabled', true);
        $('#sendAll').prop('disabled', true);

        executeCommand(command, 'all').always(function() {
            $('#sendSingle').prop('disabled', false);
            $('#sendAll').prop('disabled', false);
        });
    });

    function executeCommand(command, hosts) {
        return $.ajax({
            url: '/api/execute',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                command: command,
                hosts: hosts
            }),
            success: function(response) {
                $('#commandInput').val('');
                addLog('命令执行结果:\n' + JSON.stringify(response, null, 2), 'success');
            },
            error: function(xhr) {
                addLog('命令执行失败: ' + xhr.responseText, 'error');
            }
        });
    }

    function addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div class="log-entry ${type}">[${timestamp}] ${message}</div>`;
        const logContainer = $('#logContainer');
        logContainer.append(logEntry);
        logContainer.scrollTop(logContainer[0].scrollHeight);
    }

    $(document).on('click', '.open-terminal', function() {
        const hostId = $(this).data('id');
        window.open(`/terminal/${hostId}`, '_blank', 'width=1024,height=768');
    });

    loadHosts();

    const modal = document.getElementById('uploadModal');
    const uploadSelectedBtn = document.getElementById('uploadSelectedBtn');
    const uploadAllBtn = document.getElementById('uploadAllBtn');
    const closeBtn = document.getElementsByClassName('close')[0];
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const startUploadBtn = document.getElementById('startUploadBtn');
    const uploadProgress = document.getElementById('uploadProgress');

    let currentFile = null;
    let isUploadToSelected = true;

    uploadSelectedBtn.onclick = function() {
        modal.style.display = "block";
        isUploadToSelected = true;
    }

    uploadAllBtn.onclick = function() {
        modal.style.display = "block";
        isUploadToSelected = false;
    }

    closeBtn.onclick = function() {
        modal.style.display = "none";
        resetUploadUI();
    }

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
            resetUploadUI();
        }
    }

    selectFileBtn.onclick = function() {
        fileInput.click();
    }

    fileInput.onchange = handleFileSelect;

    dropZone.ondragover = function(e) {
        e.preventDefault();
        this.classList.add('dragover');
    }

    dropZone.ondragleave = function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
    }

    dropZone.ondrop = function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    }

    startUploadBtn.onclick = function() {
        if (!currentFile) return;
        
        startUploadBtn.disabled = true;
        startUploadBtn.style.backgroundColor = '#6c757d';
        startUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';
        
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('uploadType', isUploadToSelected ? 'selected' : 'all');
        
        if (isUploadToSelected) {
            const selectedHosts = $('#hostSelect').val();
            if (!selectedHosts || selectedHosts.length === 0) {
                alert('请选择至少一个主机');
                resetUploadButton();
                return;
            }
            formData.append('hosts', JSON.stringify(selectedHosts));
        }

        if (!startUploadBtn.dataset.uploading) {
            startUploadBtn.dataset.uploading = 'true';
            uploadFile(formData);
        }
    };

    function resetUploadButton() {
        if (startUploadBtn) {
            startUploadBtn.disabled = false;
            startUploadBtn.style.backgroundColor = '#28a745';
            startUploadBtn.innerHTML = '<i class="fas fa-upload"></i> 开始上传';
            startUploadBtn.dataset.uploading = '';
        }
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    }

    function handleFile(file) {
        currentFile = file;
        fileName.textContent = file.name;
        fileInfo.style.display = 'block';
    }

    function uploadFile(formData) {
        const xhr = new XMLHttpRequest();
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'margin-top: 10px; padding: 10px; border-radius: 4px; text-align: center;';
        fileInfo.appendChild(messageDiv);
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    messageDiv.style.backgroundColor = '#d4edda';
                    messageDiv.style.color = '#155724';
                    messageDiv.textContent = '文件上传成功！';
                    addLog('文件上传成功', 'success');
                    setTimeout(() => {
                        modal.style.display = "none";
                        resetUploadUI();
                    }, 1500);
                } else {
                    messageDiv.style.backgroundColor = '#f8d7da';
                    messageDiv.style.color = '#721c24';
                    messageDiv.textContent = '上传失败：' + response.message;
                    addLog('文件上传失败：' + response.message, 'error');
                    resetUploadButton();
                }
            } else {
                messageDiv.style.backgroundColor = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.textContent = '上传失败，请重试';
                addLog('文件上传失败', 'error');
                resetUploadButton();
            }
        };

        xhr.onerror = function() {
            messageDiv.style.backgroundColor = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.textContent = '上传出错，请重试';
            addLog('文件上传出错', 'error');
            resetUploadButton();
        };

        xhr.open('POST', '/upload_file', true);
        xhr.send(formData);
    }

    $(document).on('click', '#uploadModal .close', function() {
        document.getElementById('uploadModal').style.display = "none";
        resetUploadUI();
    });

    function resetUploadUI() {
        currentFile = null;
        if (fileInput) {
            fileInput.value = '';
        }
        if (fileInfo) {
            fileInfo.style.display = 'none';
            const elements = fileInfo.querySelectorAll('div');
            elements.forEach(el => el.remove());
        }
        resetUploadButton();
    }

    $('#pingAllHosts').click(function() {
        const hostIds = [];
        $('#hostTable tbody tr').each(function() {
            const hostId = $(this).find('.check-host').data('id');
            if (hostId) {
                hostIds.push(hostId);
            }
        });

        if (hostIds.length === 0) {
            alert('没有可用的主机');
            return;
        }
        
        const $button = $(this);
        $button.prop('disabled', true);
        $button.html('<i class="fas fa-spinner fa-spin"></i> 检查中...');
        
        $('.health-status').text('');
        
        let completedRequests = 0;

        hostIds.forEach(function(hostId) {
            const statusSpan = $(`#health-${hostId}`);
            statusSpan.text(' 检查中...');
            
            $.ajax({
                url: `/api/hosts/${hostId}/ping`,
                method: 'GET',
                success: function(response) {
                    if (response.status === 'success') {
                        statusSpan.text(' 连接正常');
                        statusSpan.css('color', 'green');
                    } else if (response.status === 'unreachable') {
                        statusSpan.text(' 无法连接');
                        statusSpan.css('color', 'red');
                    } else {
                        statusSpan.text(' 失败');
                        statusSpan.css('color', 'orange');
                    }
                },
                error: function() {
                    statusSpan.text(' 检查失败');
                    statusSpan.css('color', 'red');
                },
                complete: function() {
                    completedRequests++;
                    if (completedRequests === hostIds.length) {
                        $button.prop('disabled', false);
                        $button.html('Ping所有');
                    }
                }
            });
        });
    });
});
