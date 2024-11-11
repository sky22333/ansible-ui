FROM python:3.9-alpine

WORKDIR /app

COPY . .

# 安装依赖
RUN apk update && \
    apk add --no-cache openssh-client sshpass && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -rf /var/cache/apk/*

EXPOSE 5000

CMD ["python", "app.py"]