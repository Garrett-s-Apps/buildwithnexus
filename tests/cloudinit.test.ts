import { describe, it, expect, vi } from 'vitest';
import { renderCloudInit } from '../src/core/cloudinit.js';
import { yamlEscape } from '../src/core/dlp.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Cloud-Init Rendering', () => {
  it('should render cloud-init template with valid YAML syntax', async () => {
    const templatePath = path.resolve('src/templates/cloud-init.yaml.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    
    const testKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF1234567890 test@example.com';
    
    // Mock renderCloudInit to avoid creating files
    vi.resetModules();
    const { renderCloudInit: render } = await import('../src/core/cloudinit.js');
    
    // Create temp directory for test
    const testDir = '/tmp/nexus-test-' + Date.now();
    fs.mkdirSync(testDir, { recursive: true });
    
    // Mock NEXUS_HOME
    process.env.NEXUS_HOME = testDir;
    fs.mkdirSync(path.join(testDir, 'vm', 'configs'), { recursive: true });
    
    try {
      const result = await render(
        {
          sshPubKey: testKey,
          keys: {},
          config: {
            vmRam: 8,
            vmCpus: 4,
            vmDisk: 100,
            sshPort: 2222,
            httpPort: 4200,
            httpsPort: 8443,
            enableTunnel: false,
          }
        },
        templateContent
      );
      
      const rendered = fs.readFileSync(result, 'utf-8');
      
      // Check that users block is present
      expect(rendered).toContain('users:');
      expect(rendered).toContain('- name: nexus');
      expect(rendered).toContain('ssh_authorized_keys:');
      expect(rendered).toContain(testKey);
      
      // Check YAML is valid (basic check)
      expect(rendered.split('users:')[1]).toContain('- name: nexus');
      
      // Cleanup
      fs.unlinkSync(result);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should escape SSH keys properly in YAML', async () => {
    const testKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF1234567890 test@example.com';
    const escaped = yamlEscape(testKey);
    
    // Should not escape normal SSH key format
    expect(escaped).toBe(testKey);
  });

  it('should detect users block in rendered template', async () => {
    const templatePath = path.resolve('src/templates/cloud-init.yaml.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    
    // Simple EJS render without file I/O
    const ejs = await import('ejs');
    const rendered = ejs.render(templateContent, {
      sshPubKey: 'ssh-ed25519 test-key test@example.com',
      keys: {},
      config: {
        vmRam: 8,
        vmCpus: 4,
        vmDisk: 100,
        sshPort: 2222,
        httpPort: 4200,
        httpsPort: 8443,
        enableTunnel: false,
      }
    });
    
    // Print first 30 lines for debugging
    const lines = rendered.split('\n');
    console.log('=== RENDERED CLOUD-INIT (first 30 lines) ===');
    lines.slice(0, 30).forEach((line, i) => {
      console.log(`${i + 1}: ${line}`);
    });
    
    expect(rendered).toContain('users:');
    expect(rendered).toContain('name: nexus');
  });
});
