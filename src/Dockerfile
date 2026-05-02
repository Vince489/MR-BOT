# Multi-stage build for a secure Node.js development sandbox
FROM node:22-bullseye AS base

# Install standard dev tools the LLM will expect
# ⚠️ REMOVED iptables: runs on HOST kernel, not inside container
RUN apt-get update && apt-get install -y \
    bash \
    git \
    curl \
    wget \
    vim \
    build-essential \
    python3 \
    make \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create sandbox directory (will be tmpfs mount point at runtime)
RUN mkdir -p /sandbox

# Create non-root user with default home (/home/nodeuser) for config files
# Give nodeuser ownership of /sandbox for workspace access
RUN useradd -m -s /bin/bash nodeuser \
    && chown nodeuser:nodeuser /sandbox

# Install global npm packages at BUILD time
# These will be READ-ONLY at runtime (with ReadonlyRootfs), which is sufficient for execution
RUN npm install -g \
    npm@latest \
    typescript@latest \
    eslint@latest \
    prettier@latest

# Ensure nodeuser can READ global packages (readonly is fine for execution)
RUN chown -R nodeuser:nodeuser /usr/local/lib/node_modules \
    && chmod -R a+rX /usr/local/lib/node_modules \
    && chmod -R a+rX /usr/local/bin

# Switch to non-root user BEFORE setting up user-specific config
USER nodeuser

# Environment variables
ENV NODE_ENV=development
ENV HOME=/home/nodeuser
# Ensure npm global bin is in PATH (node images usually have this, but be explicit)
ENV PATH="/home/nodeuser/.npm-global/bin:${PATH}"
ENV NPM_CONFIG_PREFIX=/home/nodeuser/.npm-global

# Create npm config and global prefix directory in home
# These will be WRITABLE at runtime via tmpfs mount on /home/nodeuser
RUN mkdir -p /home/nodeuser/.npm-global/bin \
    && echo "prefix=/home/nodeuser/.npm-global" > /home/nodeuser/.npmrc

# Set working directory to sandbox (workspace for LLM commands)
WORKDIR /sandbox

# Keep container alive
CMD ["tail", "-f", "/dev/null"]