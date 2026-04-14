FROM debian:bookworm-slim
COPY xero /usr/local/bin/xero
ENTRYPOINT ["xero"]
