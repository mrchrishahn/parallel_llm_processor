import { stat } from 'fs/promises';
import { extname } from 'path';

export async function validateDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function isPromptFile(filename: string): boolean {
  const ext = extname(filename);
  return ext === '.txt' || ext === '.md' || ext === '';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
} 