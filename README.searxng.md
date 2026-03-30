# SearXNG Docker Setup for MR-BOT

This guide explains how to set up and use SearXNG with your MR-BOT project.

## Prerequisites
- Docker installed on your system
- Docker Compose v1.28.0+
- At least 2GB of available RAM

## Quick Start

1. **Start SearXNG**:
   ```bash
   docker-compose -f docker-compose.searxng.yml up -d
   ```

2. **Verify it's running**:
   ```bash
   docker-compose -f docker-compose.searxng.yml logs -f
   ```

3. **Access the interface**:
   - Web UI: [http://localhost:8080](http://localhost:8080)
   - API endpoint: `http://localhost:8080/search`

## Configuration

### Environment Variables
You can customize SearXNG by modifying the `environment` section in `docker-compose.searxng.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARXNG_BASE_URL` | `http://localhost:8080/` | Base URL for the instance |
| `SEARXNG_INSTANCE_NAME` | `MR-BOT Search` | Name of your instance |

### Persistent Storage
All configuration files are stored in a Docker volume named `searxng-data`. To customize settings:

1. Stop the container:
   ```bash
   docker-compose -f docker-compose.searxng.yml down
   ```

2. Edit the configuration files in the volume (use Docker volume commands or edit directly if on Linux)

3. Restart the container:
   ```bash
   docker-compose -f docker-compose.searxng.yml up -d
   ```

## Using with MR-BOT

The `webSearchTool.js` is already configured to work with this SearXNG instance:

```javascript
// In your MR-BOT configuration
process.env.SEARXNG_URL = 'http://localhost:8080';
```

### Example Search
```javascript
const { webSearchTool } = require('./src/tools/webSearchTool');

// Perform a search
const result = await webSearchTool.handler({
  query: "latest developments in AI",
  options: {
    engines: ["google", "bing"],
    language: "en",
    safesearch: 1
  }
});

console.log(result);
```

## Customization

### Adding Search Engines
To add or modify search engines:

1. Edit the `settings.yml` file in the `searxng-data` volume
2. Add your engine configuration under the `engines` section
3. Restart the container

### Privacy Settings
SearXNG includes strong privacy protections by default. You can adjust these in the `settings.yml` file:

```yaml
server:
  privacy:
    # Disable logging of search queries
    log_query: false
    # Remove tracking parameters from URLs
    clean_urls: true
```

## Maintenance

### Updating SearXNG
To update to the latest version:

```bash
docker-compose -f docker-compose.searxng.yml pull
docker-compose -f docker-compose.searxng.yml up -d
```

### Backup Configuration
To backup your configuration:

```bash
# Create a backup directory
mkdir -p backups/searxng

# Copy configuration from volume
docker run --rm -v searxng-data:/volume -v $(pwd)/backups/searxng:/backup alpine cp -r /volume /backup/
```

## HTTPS Setup (Optional)

If you need HTTPS support:

1. Uncomment the `nginx-proxy` service in `docker-compose.searxng.yml`
2. Create a `proxy/certs` directory
3. Add your SSL certificates to this directory
4. Update the SearXNG configuration to use HTTPS

## Troubleshooting

### Common Issues

1. **Port conflict**:
   - Error: `port is already allocated`
   - Solution: Change the host port in `docker-compose.searxng.yml` or stop the conflicting service

2. **Connection refused**:
   - Verify the container is running: `docker ps`
   - Check logs: `docker-compose -f docker-compose.searxng.yml logs`

3. **Slow responses**:
   - Check your internet connection
   - Try different search engines in the configuration
   - Increase Docker resource allocation

### Logs
View real-time logs:
```bash
docker-compose -f docker-compose.searxng.yml logs -f searxng
```

## Security Notes

1. By default, SearXNG is only accessible from your local machine
2. For production use, consider:
   - Adding authentication
   - Configuring HTTPS
   - Setting up a firewall
3. Regularly update to get the latest security patches

## License
SearXNG is free software licensed under the AGPL.