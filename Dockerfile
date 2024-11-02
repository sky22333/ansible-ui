# 使用 Python 官方镜像
FROM python:3.8.20-slim
# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 安装依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssh-client sshpass && \
    pip install --no-cache-dir Flask ansible && \
    rm -rf /var/lib/apt/lists/*

# 暴露端口
EXPOSE 5000

# 启动应用
CMD ["python", "app.py"]
