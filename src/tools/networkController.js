import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export class NetworkController {
  constructor(containerId) {
    this.containerId = this._sanitizeContainerId(containerId);
    this.allowedDomains = new Set();
    this.timeoutHandles = new Map();
    this.acceptRules = []; // Track ACCEPT rules for explicit cleanup
  }

  _sanitizeContainerId(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw new Error(`Invalid container ID format: ${id}`);
    }
    return id;
  }

  _validateDomain(domain) {
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(domain)) {
      throw new Error(`Invalid domain format: ${domain}`);
    }
    if (domain.length > 253) {
      throw new Error(`Domain too long: ${domain}`);
    }
    return domain;
  }

  _getDomainKey(domains) {
    return [...new Set(domains)].sort().join('|');
  }

  async _getContainerIps() {
    const { stdout } = await execAsync(
      `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}},{{.GlobalIPv6Address}}{{end}}' ${this.containerId}`
    );
    const [ipv4, ipv6] = stdout.trim().split(',');
    return {
      ipv4: ipv4 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4) ? ipv4 : null,
      ipv6: ipv6 && ipv6 !== '<nil>' && /^[0-9a-f:]+$/.test(ipv6) ? ipv6 : null
    };
  }

  async blockAllEgress() {
    try {
      const { ipv4, ipv6 } = await this._getContainerIps();

      if (ipv4) {
        // Use -C to check if rule exists; only add if missing
        await execAsync(`iptables -C DOCKER-USER -s ${ipv4} -o eth0 -j DROP 2>/dev/null || iptables -A DOCKER-USER -s ${ipv4} -o eth0 -j DROP`);
        await execAsync(`iptables -C DOCKER-USER -s ${ipv4} -p udp --dport 53 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -s ${ipv4} -p udp --dport 53 -j ACCEPT`);
        await execAsync(`iptables -C DOCKER-USER -s ${ipv4} -p tcp --dport 53 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -s ${ipv4} -p tcp --dport 53 -j ACCEPT`);
      }

      if (ipv6) {
        // IPv6 rules (same pattern)
        await execAsync(`ip6tables -C DOCKER-USER -s ${ipv6} -o eth0 -j DROP 2>/dev/null || ip6tables -A DOCKER-USER -s ${ipv6} -o eth0 -j DROP`);
        await execAsync(`ip6tables -C DOCKER-USER -s ${ipv6} -p udp --dport 53 -j ACCEPT 2>/dev/null || ip6tables -I DOCKER-USER -s ${ipv6} -p udp --dport 53 -j ACCEPT`);
        await execAsync(`ip6tables -C DOCKER-USER -s ${ipv6} -p tcp --dport 53 -j ACCEPT 2>/dev/null || ip6tables -I DOCKER-USER -s ${ipv6} -p tcp --dport 53 -j ACCEPT`);
      }
    } catch (error) {
      console.error('Failed to block egress:', error);
      throw error; // Re-throw so caller knows initialization failed
    }
  }

  async allowDomains(domains, durationMs = 30000) {
    try {
      const { ipv4, ipv6 } = await this._getContainerIps();
      const key = this._getDomainKey(domains);

      // Cancel existing timeout for same domains to avoid duplicates
      if (this.timeoutHandles.has(key)) {
        clearTimeout(this.timeoutHandles.get(key));
        this.timeoutHandles.delete(key);
      }

      for (const domain of domains) {
        try {
          const safeDomain = this._validateDomain(domain);
          const { stdout } = await execAsync(`getent hosts ${safeDomain} 2>/dev/null | awk '{print $1}' | grep -E '^[0-9.]+$' || true`);
          const ips = stdout.trim().split('\n').filter(ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));

          for (const ip of ips) {
            const rule = `-s ${ipv4} -d ${ip} -j ACCEPT`;
            await execAsync(`iptables -C DOCKER-USER ${rule} 2>/dev/null || iptables -I DOCKER-USER ${rule}`);
            if (!this.acceptRules.includes(rule)) {
              this.acceptRules.push(rule);
            }
            console.debug(`🌐 Allowed ${safeDomain} (${ip}) for container ${this.containerId.slice(0, 12)}`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not allow ${domain}: ${error.message}`);
        }
      }

      const timeoutId = setTimeout(async () => {
        try {
          await this.revokeDomains(domains);
        } catch (error) {
          console.error('Error revoking timed-out domains:', error);
        } finally {
          this.timeoutHandles.delete(key);
        }
      }, durationMs);

      this.timeoutHandles.set(key, timeoutId);
      console.log(`🌐 Allowed network access for: ${domains.join(', ')} (${durationMs}ms)`);
    } catch (error) {
      console.error('Failed to allow domains:', error);
      throw error;
    }
  }

  async revokeDomains(domains) {
    try {
      const { ipv4 } = await this._getContainerIps();

      for (const domain of domains) {
        try {
          const safeDomain = this._validateDomain(domain);
          const { stdout } = await execAsync(`getent hosts ${safeDomain} 2>/dev/null | awk '{print $1}' | grep -E '^[0-9.]+$' || true`);
          const ips = stdout.trim().split('\n').filter(ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));

          for (const ip of ips) {
            const rule = `-s ${ipv4} -d ${ip} -j ACCEPT`;
            await execAsync(`iptables -D DOCKER-USER ${rule} 2>/dev/null || true`);
            this.acceptRules = this.acceptRules.filter(r => r !== rule);
            console.debug(`🔒 Revoked ${safeDomain} (${ip})`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not revoke ${domain}: ${error.message}`);
        }
      }
    } catch (error) {
      console.error('Error revoking domains:', error);
      throw error;
    }
  }

  async cleanup() {
    try {
      // Clear all timeouts
      for (const timeoutId of this.timeoutHandles.values()) {
        clearTimeout(timeoutId);
      }
      this.timeoutHandles.clear();

      // Remove tracked ACCEPT rules
      for (const rule of this.acceptRules) {
        try {
          // Convert insert rule to delete rule
          const deleteRule = rule.replace('-I', '-D');
          await execAsync(`iptables ${deleteRule} 2>/dev/null || true`);
        } catch (error) {
          // Rule might not exist, which is fine
          console.debug(`Rule not found during cleanup: ${rule}`);
        }
      }
      this.acceptRules = [];

      // Re-apply default-deny (idempotent)
      await this.blockAllEgress();

      console.log(`🧹 NetworkController cleaned up for ${this.containerId.slice(0, 12)}`);
    } catch (error) {
      console.error('Error during cleanup:', error);
      throw error;
    }
  }
}