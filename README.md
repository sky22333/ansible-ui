### Ansible 批量管理主机面板

- 交互式终端页面和文件管理
- 批量执行命令和批量上传文件
- 快速批量添加主机

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

生产环境建议用`nginx`反代，并用`nginx`开启白名单访问限制，以下是`docker-compose`示例配置：
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

  nginx:
    image: nginx:alpine
    container_name: nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    restart: always
```

`nginx.conf`白名单示例

```
server {
    listen 80;
    # listen 443 ssl;

    # 允许访问的 IP 地址
    allow 192.168.0.12;
    deny all;

    location / {
        proxy_pass http://ansible:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```





---


本项目基于ansible项目开发：https://github.com/ansible/ansible
