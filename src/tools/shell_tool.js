import Docker from 'dockerode';
import EventEmitter from 'events';
import chokidar from 'chokidar';
import { NetworkController } from './networkController.js';

const docker = new Docker();

let containerInstance = null;
const IMAGE_NAME = 'node-sandbox';
// Removed module-level networkController

/**
 * Shell Tool for LLM/Agent using Docker, structured for Google Function Calling
 * Provides secure shell access with persistent containers and structured responses
 * 
 * Enterprise Features:
 * - Real-time event streaming with EventEmitter
 * - File system monitoring with chokidar
 * - Command queuing and management
 * - Enhanced error handling and recovery
 */
class ShellTool extends EventEmitter {
  constructor() {
    super();
    this.name = 'shell_execute';
    this.description = 'Execute bash commands in a secure terminal. Use this for file operations, npm, and git.';
    this.initialized = false;
    this.commandQueue = [];
    this.isProcessing = false;
    this.logBuffer = [];
    this.maxLogBuffer = 1000;
    this.fileWatcher = null;
    this.networkController = null; // Instance property
    this.workspacePath = '/sandbox';
  }

  /**
   * Initializes the shell tool by checking Docker connectivity
   */
  async initialize() {
    try {
      await docker.ping();
      console.log('✅ Docker service found.');
      this.initialized = true;
      
      // Check for existing running container and reuse it
      await this._findOrCreateContainer();
      
    } catch (e) {
      console.error('❌ Docker not found. Shell tool will be disabled.');
      this.initialized = false;
    }
  }
  
  /**
   * Find existing running container or create new one
   */
  async _findOrCreateContainer() {
    try {
      const containers = await docker.listContainers({ all: true });
      const nodeSandboxContainers = containers.filter(c =>
        c.Image === 'node-sandbox' || c.Image === 'node-sandbox:latest'
      );

      if (nodeSandboxContainers.length > 0) {
        // Find a running container to reuse
        const runningContainer = nodeSandboxContainers.find(c => c.State === 'running');

        if (runningContainer) {
          console.log(`🔄 Reusing existing running container: ${runningContainer.Id.substring(0, 12)}`);
          containerInstance = docker.getContainer(runningContainer.Id);

          // Initialize network controller
          this.networkController = new NetworkController(containerInstance.id);
          await this.networkController.blockAllEgress();

          // Start file system monitoring
          this._startFileMonitoring();
          return;
        }

        // If no running container, try to start the first one
        const containerInfo = nodeSandboxContainers[0];
        console.log(`🔄 Starting existing container: ${containerInfo.Id.substring(0, 12)}`);
        containerInstance = docker.getContainer(containerInfo.Id);
        await containerInstance.start();

        // Initialize network controller
        this.networkController = new NetworkController(containerInstance.id);
        await this.networkController.blockAllEgress();

        // Start file system monitoring
        this._startFileMonitoring();
      } else {
        console.log('🐳 Creating new Docker container...');
        containerInstance = await docker.createContainer({
          Image: IMAGE_NAME,
          Tty: true,
          WorkingDir: this.workspacePath,
            HostConfig: {
              Memory: 512 * 1024 * 1024, // 512MB limit
              CpuQuota: 50000, // 0.5 CPU limit
              NetworkMode: 'bridge', // Allow network stack, but control via firewall
              CapDrop: ['ALL'],
              SecurityOpt: ['no-new-privileges:true'],
              ReadonlyRootfs: true,
              Tmpfs: {
                '/tmp': 'rw,noexec,nosuid,size=100m',
                '/sandbox': 'rw,noexec,nosuid,size=256m',
                '/home/nodeuser': 'rw,noexec,nosuid,size=50m'
              }
            }
        });
        await containerInstance.start();
        console.log('✅ Container started successfully');

        // Initialize network controller
        this.networkController = new NetworkController(containerInstance.id);
        await this.networkController.blockAllEgress();

        // Start file system monitoring
        this._startFileMonitoring();
      }
    } catch (error) {
      console.error('❌ Failed to find or create container:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Enhanced command execution with real-time events and queuing
   * @param {Object} params - Parameters for command execution
   * @param {string} params.command - The bash command to run
   * @param {string} [params.cwd] - The directory to run the command in (default: '/sandbox')
   * @param {Object} agent - The agent instance for progress updates
   * @returns {Promise<Object>} - Structured response with exit code and output
   */
  async execute({ command, cwd = '/sandbox' }, agent) {
    const commandId = this.generateCommandId();
    const startTime = Date.now();
    
    try {
      // Emit command start event
      this.emit('command-start', { 
        commandId, 
        command, 
        cwd, 
        timestamp: startTime 
      });
      
      // Add to command queue for management
      const commandTask = {
        id: commandId,
        command,
        cwd,
        startTime,
        agent
      };
      
      this.commandQueue.push(commandTask);
      
      // Process command (with queuing logic for future enhancement)
      const result = await this._executeCommand(commandTask);
      
      const duration = Date.now() - startTime;
      
      // Emit command complete event
      this.emit('command-complete', { 
        commandId, 
        command, 
        exitCode: result.exitCode, 
        duration,
        timestamp: Date.now() 
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit command error event
      this.emit('command-error', { 
        commandId, 
        command, 
        error: error.message, 
        duration,
        timestamp: Date.now() 
      });
      
      console.error('❌ Shell tool error:', error);
      return { 
        error: `Failed to execute command: ${error.message}`,
        exitCode: 1,
        stdout: '',
        stderr: error.message
      };
    }
  }

  /**
   * Internal command execution logic
   */
async _executeCommand(commandTask) {
    const { command, cwd, agent } = commandTask;
    const requiresNetwork = this._requiresNetworkAccess(command);

    try {
      // Ensure container is running
      if (!containerInstance) {
        if (agent) {
          agent.emit('progress-update', '🚀 Spawning Docker sandbox...');
        }
        console.log('🐳 Creating new Docker container...');
        containerInstance = await docker.createContainer({
          Image: IMAGE_NAME,
          Tty: true,
          WorkingDir: this.workspacePath,
          HostConfig: {
            Memory: 512 * 1024 * 1024, // 512MB limit
            CpuQuota: 50000, // 0.5 CPU limit
            NetworkMode: 'bridge', // Allow network stack, but control via firewall
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            ReadonlyRootfs: true,
            Tmpfs: {
              '/tmp': 'rw,noexec,nosuid,size=100m',
              '/sandbox': 'rw,noexec,nosuid,size=256m',
              '/home/nodeuser': 'rw,noexec,nosuid,size=50m'
            }
          }
        });
        await containerInstance.start();
        console.log('✅ Container started successfully');

        // Initialize network controller
        this.networkController = new NetworkController(containerInstance.id);
        await this.networkController.blockAllEgress();

        // Start file system monitoring
        this._startFileMonitoring();
      } else {
        // Check if container is still running, if not, restart it
        try {
          const containerInfo = await containerInstance.inspect();
          if (!containerInfo.State.Running) {
            console.log('🔄 Container not running, restarting...');
            await containerInstance.start();
          }
        } catch (error) {
          console.log('🔄 Container state check failed, recreating...');
          try {
            await containerInstance.remove();
          } catch (removeError) {
            console.log('⚠️ Could not remove old container:', removeError.message);
          }
          // Create new container
          containerInstance = await docker.createContainer({
            Image: IMAGE_NAME,
            Tty: true,
            WorkingDir: this.workspacePath,
            HostConfig: {
              Memory: 512 * 1024 * 1024, // 512MB limit
              CpuQuota: 50000, // 0.5 CPU limit
              NetworkMode: 'bridge', // Allow network stack, but control via firewall
              CapDrop: ['ALL'],
              SecurityOpt: ['no-new-privileges:true'],
              ReadonlyRootfs: true,
              Tmpfs: {
                '/tmp': 'rw,noexec,nosuid,size=100m',
                '/sandbox': 'rw,noexec,nosuid,size=256m',
                '/home/nodeuser': 'rw,noexec,nosuid,size=50m'
              }
            }
          });
          await containerInstance.start();
          console.log('✅ New container started successfully');

          // Initialize network controller
          this.networkController = new NetworkController(containerInstance.id);
          await this.networkController.blockAllEgress();
        }
      }

      // Allow network access if required
      if (requiresNetwork) {
        const domains = this._extractDomains(command);
        console.log(`🌐 Temporarily allowing network for: ${domains.join(', ')}`);
        await this.networkController.allowDomains(domains, 45000);
      }

      if (agent) {
        agent.emit('progress-update', `💻 Running: ${command}`);
      }
      console.log(`🔧 Executing command: ${command} in ${cwd}`);

      const exec = await containerInstance.exec({
        Cmd: ['bash', '-c', command],
        WorkingDir: cwd,
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      
      return new Promise((resolve, reject) => {
        let output = '';
        let stderr = '';

        // Set a timeout for command execution
        const timeout = setTimeout(() => {
          reject(new Error(`Command timed out after 60s: ${command}`));
        }, 60000); // 60 second hard limit

        stream.on('data', (chunk) => {
          const text = chunk.toString();
          if (text) {
            output += text;

            // Add to log buffer for reconnection support
            this._addToLogBuffer({
              type: 'output',
              command,
              output: text,
              timestamp: Date.now()
            });

            // Emit real-time output event
            this.emit('output', {
              command,
              output: text,
              timestamp: Date.now()
            });

            // Optional: stream this back to your SSE log if you want real-time terminal views
            if (agent) {
              agent.emit('progress-update', `Output: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
            }
          }
        });

        stream.on('error', (err) => {
          clearTimeout(timeout);
          console.error('Stream error:', err.message);
          reject(err);
        });

        stream.on('end', async () => {
          clearTimeout(timeout);
          const status = await exec.inspect();
          const result = {
            exitCode: status.ExitCode,
            stdout: output.trim(),
            stderr: stderr.trim(),
            cwd: cwd,
            timedOut: false
          };

          // Truncate output if too large to prevent token overflow
          if (result.stdout && result.stdout.length > 2000) {
            result.stdout = result.stdout.substring(0, 1000) +
                           '\n... [OUTPUT TRUNCATED] ...\n' +
                           result.stdout.substring(result.stdout.length - 1000);
          }

          if (result.stderr && result.stderr.length > 1000) {
            result.stderr = result.stderr.substring(0, 500) +
                           '\n... [STDERR TRUNCATED] ...\n' +
                           result.stderr.substring(result.stderr.length - 500);
          }

          console.log(`✅ Command completed with exit code: ${result.exitCode}`);
          resolve(result);
        });
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gets the current working directory of the container
   */
  async getCurrentDirectory() {
    if (!containerInstance) {
      return '/sandbox';
    }
    try {
      const exec = await containerInstance.exec({
        Cmd: ['pwd'],
        AttachStdout: true,
        AttachStderr: true
      });
      const stream = await exec.start();
      let output = '';
      stream.on('data', (chunk) => {
        output += chunk.toString();
      });
      await new Promise(resolve => stream.on('end', resolve));
      return output.trim() || '/sandbox';
    } catch (error) {
      return '/sandbox';
    }
  }

  /**
   * Lists files in the current directory
   */
  async listFiles(path = '.') {
    if (!containerInstance) {
      return { error: 'No active container' };
    }
    try {
      const exec = await containerInstance.exec({
        Cmd: ['ls', '-la', path],
        AttachStdout: true,
        AttachStderr: true
      });
      const stream = await exec.start();
      let output = '';
      stream.on('data', (chunk) => {
        output += chunk.toString();
      });
      await new Promise(resolve => stream.on('end', resolve));
      return { output: output.trim() };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Generate unique command ID
   */
  generateCommandId() {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add output to log buffer for reconnection support
   */
  _addToLogBuffer(entry) {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogBuffer) {
      this.logBuffer.shift(); // Remove oldest entries
    }
  }

  // Check if a command requires network access
  _requiresNetworkAccess(command) {
    const patterns = [
      /\bnpm\s+(install|i)\b/,
      /\byarn\s+(install|add)\b/,
      /\bgit\s+clone\b/,
      /\bcurl\s+https?:\/\//,
      /\bwget\s+https?:\/\//,
      /\bapt-get\s+install\b/,
    ];
    return patterns.some(regex => regex.test(command));
  }

  // Extract domains for network access
  _extractDomains(command) {
    const domainMap = {
      'npm install': ['registry.npmjs.org'],
      'npm i': ['registry.npmjs.org'],
      'git clone': ['github.com', 'gitlab.com', 'bitbucket.org'],
      'curl': [/https?:\/\/([^/]+)/],
      'wget': [/https?:\/\/([^/]+)/],
    };

    const domains = new Set();

    for (const [trigger, domainList] of Object.entries(domainMap)) {
      if (command.includes(trigger)) {
        if (typeof domainList[0] === 'object') {
          const regex = domainList[0];
          const match = command.match(regex);
          if (match && match[1]) {
            const host = match[1].split(':')[0]; // Remove port
            if (/^[a-zA-Z0-9.-]+$/.test(host)) {
              domains.add(host);
            }
          }
        } else {
          domainList.forEach(domain => domains.add(domain));
        }
      }
    }

    // Extract URLs from curl/wget commands
    const urlRegex = /https?:\/\/([^/\s"']+)/g;
    let match;
    while ((match = urlRegex.exec(command)) !== null) {
      let host = match[1].split(':')[0]; // Remove port
      if (/^[a-zA-Z0-9.-]+$/.test(host)) {
        domains.add(host);
      }
    }

    return Array.from(domains);
  }

  /**
   * Start file system monitoring
   */
  _startFileMonitoring() {
    // Disable file monitoring since no bind mounts for security
    console.warn('⚠️ File monitoring disabled: no bind mounts for security');
  }

  /**
   * Stop file system monitoring
   */
  _stopFileMonitoring() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
      console.log('📁 File system monitoring stopped');
    }
  }

  /**
   * Get recent log buffer for client reconnection
   */
  getLogBuffer() {
    return this.logBuffer.slice();
  }

  /**
   * Get command queue status
   */
  getCommandQueue() {
    return this.commandQueue.map(task => ({
      id: task.id,
      command: task.command,
      cwd: task.cwd,
      startTime: task.startTime,
      status: 'pending'
    }));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Stop file monitoring
    this._stopFileMonitoring();

    // Cleanup network controller
    if (this.networkController) {
      try {
        await this.networkController.cleanup();
        this.networkController = null;
      } catch (error) {
        console.error('Error cleaning up network controller:', error);
      }
    }

    // Clear command queue
    this.commandQueue = [];

    // Stop container
    if (containerInstance) {
      try {
        await containerInstance.stop();
        await containerInstance.remove();
        containerInstance = null;
        console.log('🧹 Container cleaned up');
      } catch (error) {
        console.error('Error cleaning up container:', error);
      }
    }

    // Clear log buffer
    this.logBuffer = [];
  }
}

// --- Model-Agnostic Tool Structure ---
const shellToolInstance = new ShellTool();

/**
 * Initializes the ShellTool
 * @returns {Promise<void>}
 */
export async function initializeShellTool() {
  await shellToolInstance.initialize();
}

// Optimized tool definition for Mistral SDK
export const shellTool = {
  function: {
    name: 'shell_execute',
    description: 'Execute bash commands in a secure terminal. Use this for file operations, npm, and git.',
    parameters: {
      type: 'object',
      properties: {
        command: { 
          type: 'string', 
          description: 'The bash command to run (e.g., "npm install", "git status", "ls -la")' 
        },
      cwd: {
        type: 'string',
        description: 'The directory to run the command in (default: "/sandbox")',
        default: '/sandbox'
      }
      },
      required: ['command']
    }
  },
  handler: async (params) => {
    console.log(`🔧 [SHELL TOOL] Executing shell_execute with params:`, params);
    
    // Extract task_progress if present
    const { task_progress, ...restParams } = params;
    
    try {
      const result = await shellToolInstance.execute(restParams);
      // Return the result directly (not JSON stringified) for proper tool response format
      return result;
    } catch (error) {
      console.error(`🔧 [SHELL TOOL] Unexpected error during execution:`, error);
      return {
        error: `An unexpected error occurred in the shell tool: ${error.message}`,
        exitCode: 1,
        stdout: '',
        stderr: error.message
      };
    }
  }
};

// Export the tool function for backward compatibility
export const shell = shellTool.handler;

/**
 * Returns the active Docker container instance (for PTY sessions)
 */
export function getContainer() {
  return containerInstance;
}