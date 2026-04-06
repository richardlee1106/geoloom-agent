function unsupported() {
  throw new Error('child_process is not available in browser builds.');
}

export const spawn = unsupported;
export const exec = unsupported;
export const execFile = unsupported;
export const fork = unsupported;
export const execSync = unsupported;
export const spawnSync = unsupported;

export default {
  spawn,
  exec,
  execFile,
  fork,
  execSync,
  spawnSync
};
