# Ansible Web管理面板

轻量级，简单易用的Ansible Web管理面板，提供批量主机管理、命令执行、文件传输和Web终端等功能。适合小白用户。

<p align="center">
  <img src="https://count.getloli.com/get/@sky22333.ansible-ui?theme=rule34" alt="Visitors">
</p>

## 功能特性

- 主机管理：批量添加主机
- 支持密码认证，支持使用统一的密钥认证
- 主机密码加密存储，提高安全性
- 命令执行：向选中主机发送命令并查看结果
- 文件上传：上传文件到选中主机
- 自定义Playbook执行：编写和执行Ansible Playbook任务
- Web终端：通过浏览器直接连接到远程主机
- 访问日志：记录和查看系统访问情况

## 安全特性

- **凭证派生加密**：系统使用管理员的用户名和密码派生加密密钥，提供额外的安全层
- **会话隔离**：加密密钥仅在用户登录会话中存在，未登录状态下无法访问加密数据
- **零本地存储**：加密密钥完全不会存储在文件系统中，仅在内存中派生和使用
- **无默认凭证**：系统强制要求设置管理员环境变量，不使用任何默认值或备用方案

## Docker快速部署
```
docker run -d \
  --name ansible-ui \
  -p 5000:5000 \
  -e ANSIBLE_HOST_KEY_CHECKING=False \
  -e ADMIN_USERNAME=admin123 \
  -e ADMIN_PASSWORD=admin123 \
  -v ./ansible:/app/db \
  -v /root/.ssh:/root/.ssh:ro \
  ghcr.io/sky22333/ansible-ui
```
建议反代并开启HTTPS加强安全性。务必设置一个强密码

## 注意事项

- **环境变量要求**：请修改`ADMIN_USERNAME`和`ADMIN_PASSWORD`用户名密码的环境变量
- **密钥生成**：系统完全依赖管理员凭证派生加密密钥，无任何本地密钥文件
- **密码更改**：如果修改了管理员密码，之前加密的数据将无法解密，请在修改密码前备份重要数据
- **会话限制**：加密密钥仅在登录会话中有效，如果服务重启，需要重新登录才能访问加密数据
- **密钥认证连接主机**：当开启密钥认证连接主机后，则所有主机使用统一的密钥，并且添加主机时无需添加密码

---

### 密钥认证连接主机

默认会读取容器内的`/root/.ssh/id_ed25519`

可以直接宿主机生成密钥对，然后映射进去，也可以进入容器内操作

**生成 SSH 密钥对**
```
ssh-keygen -t ed25519
```
> 一路回车即可，默认生成在`/root/.ssh/id_ed25519`和`id_ed25519.pub`

**将公钥复制到目标主机**
```
ssh-copy-id -i /root/.ssh/id_ed25519.pub root@192.168.2.1
```
如果你的目标主机ssh端口不是默认的22，则需要指定端口参数`-o Port=2222`

这条命令会自动把`id_ed25519.pub`的内容追加到目标主机的`/root/.ssh/authorized_keys`中

多个主机可以使用脚本for循环批量执行


## 预览

![1](./.github/demo/1.jpg)

---

![2](./.github/demo/2.jpg)

---

![3](./.github/demo/3.jpg)

---

![4](./.github/demo/4.jpg)

---

![5](./.github/demo/5.jpg)

---

![6](./.github/demo/6.jpg)

---

![7](./.github/demo/7.jpg)

---

![8](./.github/demo/8.jpg)

---

## Stargazers over time
[![Stargazers over time](https://starchart.cc/sky22333/ansible-ui.svg?variant=adaptive)](https://starchart.cc/sky22333/ansible-ui)
