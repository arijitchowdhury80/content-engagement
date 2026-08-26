import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

let memoryCache = { at: 0, value: null };

export function systemMemoryUsedPercent({ platform = process.platform, now = Date.now } = {}) {
  const current = now();
  if (memoryCache.value !== null && current - memoryCache.at < 1_000) return memoryCache.value;
  let used;
  if (platform === 'darwin') {
    const output = execFileSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 2_000 });
    const free = Number(/System-wide memory free percentage:\s*(\d+)%/.exec(output)?.[1]);
    if (Number.isFinite(free)) used = 100 - free;
  } else if (platform === 'linux' && fs.existsSync('/proc/meminfo')) {
    const values = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').map((line) => {
      const match = /^(\w+):\s+(\d+)/.exec(line);
      return match ? [match[1], Number(match[2])] : [line, NaN];
    }));
    if (Number.isFinite(values.MemTotal) && Number.isFinite(values.MemAvailable)) {
      used = (1 - values.MemAvailable / values.MemTotal) * 100;
    }
  }
  if (!Number.isFinite(used)) used = (1 - os.freemem() / os.totalmem()) * 100;
  memoryCache = { at: current, value: used };
  return used;
}

function cpuTotals() {
  return os.cpus().reduce((total, cpu) => {
    const times = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    total.idle += cpu.times.idle;
    total.total += times;
    return total;
  }, { idle: 0, total: 0 });
}

export class HostHealthMonitor {
  constructor({ intervalMs = 250 } = {}) {
    this.intervalMs = intervalMs;
    this.samples = [];
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.previousCpu = null;
    this.timer = null;
  }

  start() {
    if (this.timer) throw new Error('Host monitor is already running');
    this.histogram.enable();
    this.previousCpu = cpuTotals();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  sample() {
    const next = cpuTotals();
    const deltaTotal = next.total - this.previousCpu.total;
    const deltaIdle = next.idle - this.previousCpu.idle;
    const cpuPercent = deltaTotal > 0 ? (1 - deltaIdle / deltaTotal) * 100 : 0;
    this.previousCpu = next;
    const usedMemoryPercent = systemMemoryUsedPercent();
    const sample = {
      at: new Date().toISOString(),
      cpuPercent,
      usedMemoryPercent,
      processRssBytes: process.memoryUsage().rss,
      eventLoopP99Ms: this.histogram.percentile(99) / 1e6,
    };
    this.samples.push(sample);
    this.histogram.reset();
    return sample;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const final = this.sample();
    this.histogram.disable();
    return final;
  }
}

export function evaluateHostHealth(samples, thresholds = {}) {
  const limits = {
    averageCpuPercent: 80,
    maximumMemoryPercent: 80,
    maximumEventLoopP99Ms: 100,
    ...thresholds,
  };
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Host health samples are required');
  const averageCpuPercent = samples.reduce((sum, item) => sum + item.cpuPercent, 0) / samples.length;
  const maximumMemoryPercent = Math.max(...samples.map((item) => item.usedMemoryPercent));
  const maximumEventLoopP99Ms = Math.max(...samples.map((item) => item.eventLoopP99Ms));
  const violations = [];
  if (averageCpuPercent >= limits.averageCpuPercent) violations.push('average_cpu');
  if (maximumMemoryPercent >= limits.maximumMemoryPercent) violations.push('memory');
  if (maximumEventLoopP99Ms >= limits.maximumEventLoopP99Ms) violations.push('event_loop');
  return { pass: violations.length === 0, averageCpuPercent, maximumMemoryPercent, maximumEventLoopP99Ms, violations };
}
