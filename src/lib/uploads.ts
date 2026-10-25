import path from 'node:path';

// Railway mounts this directory on a persistent volume; local development keeps its existing path.
export function uploadDirectory() {
  return process.env.NEXUS_UPLOAD_DIR ?? path.join(process.cwd(), 'storage/uploads');
}
