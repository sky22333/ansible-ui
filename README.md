### Ansible 批量管理主机面板

- 交互式终端页面和文件管理
- 批量执行命令和批量上传文件
- 快速批量添加主机
- 更多功能

1. **Docker快速部署**：

```
docker run -d \
  --name ansible \
  -p 5000:5000 \
  -e ANSIBLE_HOST_KEY_CHECKING=False \
  -e ADMIN_USERNAME=admin123 \
  -e ADMIN_PASSWORD=admin123 \
  -v ./ansible:/app/db \
  ghcr.io/sky22333/ansible
```

2. **访问面板**：
   - 打开浏览器，输入`http://IP:5000`访问面板<br>默认用户名`admin123`，默认密码`admin123`<br>通过环境变量修改用户名和密码。


     
| **支持的命令**         | **示例**                                           | **说明**                           |
|---------------------|--------------------------------------------------|----------------------------------|
| **文件操作命令**    | `ls`, `cp`, `mv`, `rm`                          | 用于列出、复制、移动和删除文件       |
| **脚本执行**        | `./script.sh`                                  | 执行指定的Shell脚本             |
| **远程脚本**        |  `bash <(wget -qO- https://github.com/xx/shell/raw/main/xx.sh)`   | 执行指定的远程shell脚本              |
| **管道和重定向**    | `echo "Hello, World!"  grep "Hello" > output.txt`  | 使用管道和重定向进行数据处理        |
| **条件和循环**      | `if [ -f "file.txt" ]; then echo "File exists"; fi` | 使用条件语句执行相应操作           |
| **复杂命令**        | `cd /path/to/directory; ./run_script.sh`       | 组合多个命令，使用分号分隔          |
| **环境变量**        | `VAR=value your_command`                         | 设置环境变量并执行命令              |


3. **日志返回码**：

| 返回码 | 含义                         |
| ------ | ---------------------------- |
| 0      | 执行成功                         |
| 1      | 一般错误                     |
| 2      | 误用的命令                   |
| 126    | 命令无法执行                 |
| 127    | 命令未找到                   |
| 128    | 无效的退出状态               |
| 130    | 脚本被用户中断               |
| 137    | 进程被杀死                   |
| 255    | 退出状态未定义               |


4：**安全访问**：

生产环境建议用`caddy`反代，并启用IP白名单访问控制，以下是`docker-compose`示例配置：
```
services:
  ansible:
    image: ghcr.io/sky22333/ansible
    container_name: ansible
    environment:
      - ANSIBLE_HOST_KEY_CHECKING=False
      - ADMIN_USERNAME=admin123
      - ADMIN_PASSWORD=admin123
    volumes:
      - ./ansible:/app/db
    restart: always
    
  caddy:
    image: caddy:alpine
    container_name: caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    restart: always
```

`Caddyfile`白名单示例

> 支持IP段，多个IP用空格分隔

```
example.com {
    encode gzip

    # IP 限制，允许的IP
    @allowedIPs remote_ip 192.168.1.12
    handle @allowedIPs {
        reverse_proxy ansible:5000
    }

    # 默认拒绝所有其他 IP
    handle {
        respond "Access denied" 403
    }
}
```


---

### 预览

<img src="https://github.com/sky22333/ansible/blob/340c84adcf2ade357e646626dc3602f74cf108a1/.github/workflows/test.png" alt="PC截图" width="900">



---


- 感谢[ansible](https://github.com/ansible/ansible)

**免责申明：代码写的很烂，生产环境慎重使用，造成的各种后果本人概不负责。**

**使用本程序必循遵守部署免责声明。使用本程序必循遵守部署服务器所在地、所在国家和用户所在国家的法律法规, 程序作者不对使用者任何不当行为负责。**
