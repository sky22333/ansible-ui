$(document).ready(function() {
    // 加载主机列表
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
                            <button class="btn btn-sm btn-success check-host" data-id="${host.id}">ping</button>
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

    // 简单的格式验证
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

    // 批量添加主机
    $('#addHosts').click(function() {
        const inputText = $('#batchInput').val();
        if (!inputText.trim()) {
            addLog('请输入主机信息', 'error');
            return;
        }

        // 验证输入格式
        const validation = validateHostInput(inputText);
        if (!validation.isValid) {
            validation.errors.forEach(error => {
                addLog(error, 'error');
            });
            return;
        }

        // 禁用按钮并更改文字
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
                // 恢复按钮状态和文字
                $addButton.prop('disabled', false).text('添加主机');
            }
        });
    });

    // 删除主机
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

    // 编辑主机
    $(document).on('click', '.edit-host', function() {
        const hostId = $(this).data('id');
        $.get('/api/hosts/' + hostId, function(host) {
            $('#editHostId').val(host.id);
            $('#editHostComment').val(host.comment);
            $('#editHostAddress').val(host.address);
            $('#editHostUsername').val(host.username);
            $('#editHostPort').val(host.port);
            $('#editHostPassword').val('');
            $('#editHostModal').modal('show');
        });
    });

    // 保存主机编辑
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
                $('#editHostModal').modal('hide');
                loadHosts();
                addLog('成功更新主机信息', 'success');
            },
            error: function(xhr) {
                addLog('更新主机失败: ' + xhr.responseText, 'error');
            }
        });
    });

    // 连通性测试
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

    // 发送命令
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

        // 禁用按钮
        $('#sendSingle').prop('disabled', true);
        $('#sendAll').prop('disabled', true);

        executeCommand(command, selectedHosts).always(function() {
            // 恢复按钮
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

        // 禁用按钮
        $('#sendSingle').prop('disabled', true);
        $('#sendAll').prop('disabled', true);

        executeCommand(command, 'all').always(function() {
            // 恢复按钮
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

    // 添加终端按钮点击事件
    $(document).on('click', '.open-terminal', function() {
        const hostId = $(this).data('id');
        window.open(`/terminal/${hostId}`, '_blank', 'width=1024,height=768');
    });

    // 初始加载
    loadHosts();

    // 将日志按钮添加到导航栏的 Ansible面板 文字旁边
    $('.navbar-brand').append(`
        <button class="btn btn-outline-light btn-sm ms-3" style="padding: 0.15rem 0.35rem; font-size: 0.75rem;" id="showLogs">
            <i class="fas fa-history fa-sm"></i> 访问日志
        </button>
        
        <!-- 日志弹窗 -->
        <div class="modal fade" id="logsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content" style="font-size: 0.875rem;">
                    <div class="modal-header bg-dark text-white py-2">
                        <h5 class="modal-title" style="font-size: 1rem;">
                            <i class="fas fa-history"></i> 系统访问日志
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="关闭"></button>
                    </div>
                    <div class="modal-body">
                        <div class="d-flex gap-2 mb-3">
                            <button class="btn btn-outline-dark btn-sm" id="cleanupLogs" style="font-size: 0.875rem;">
                                <i class="fas fa-broom"></i> 清理7天前的日志
                            </button>
                            <div class="flex-grow-1 d-flex gap-2">
                                <input type="text" class="form-control form-control-sm" id="logSearchIP" placeholder="搜索IP" style="max-width: 200px;">
                                <input type="text" class="form-control form-control-sm" id="logSearchPath" placeholder="搜索路径" style="max-width: 200px;">
                                <button class="btn btn-outline-primary btn-sm" id="searchLogs">
                                    <i class="fas fa-search"></i> 搜索
                                </button>
                                <button class="btn btn-outline-secondary btn-sm" id="resetSearch">
                                    <i class="fas fa-undo"></i> 重置
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-striped table-hover" style="font-size: 0.875rem;">
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
        </div>
    `);

    // 修改加载访问日志函数，添加过滤功能
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
                
                // 根据状态码设置颜色
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

    // 搜索按钮点击事件
    $('#searchLogs').click(function() {
        const ipFilter = $('#logSearchIP').val().trim();
        const pathFilter = $('#logSearchPath').val().trim();
        loadAccessLogs(ipFilter, pathFilter);
    });

    // 重置搜索按钮点击事件
    $('#resetSearch').click(function() {
        $('#logSearchIP').val('');
        $('#logSearchPath').val('');
        loadAccessLogs();
    });

    // 显示日志弹窗
    $('#showLogs').click(function() {
        loadAccessLogs();
        $('#logsModal').modal('show');
    });

    // 清理旧日志
    $('#cleanupLogs').click(function() {
        if (confirm('确定要清理7天前的日志吗？')) {
            $.post('/api/access-logs/cleanup', function(response) {
                alert(response.message);
                loadAccessLogs();
            });
        }
    });
});
