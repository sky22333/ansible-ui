### Ansible 批量管理主机面板


1. **Docker部署**：

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




   - 数据库存储主机信息和命令日志：`db/ansible.db`

