FROM python:3.8.20-slim

WORKDIR /app

COPY . .

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssh-client sshpass && \
    pip install --no-cache-dir Flask ansible flask-sock paramiko && \
    rm -rf /var/lib/apt/lists/*


EXPOSE 5000

CMD ["python", "app.py"]
