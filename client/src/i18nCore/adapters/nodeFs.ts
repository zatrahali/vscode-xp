import * as fsPromises from 'fs/promises';
import path from 'path';
import type { FileAccess } from './types';

/** Node fs implementation of FileAccess (tests, scripts). */
export function createNodeFileAccess(): FileAccess {
  return {
    async exists(p: string): Promise<boolean> {
      try {
        await fsPromises.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async readText(p: string): Promise<string | undefined> {
      try {
        return await fsPromises.readFile(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    async writeText(p: string, content: string): Promise<void> {
      await fsPromises.mkdir(path.dirname(p), { recursive: true });
      await fsPromises.writeFile(p, content, 'utf8');
    },
    async mkdirp(dir: string): Promise<void> {
      await fsPromises.mkdir(dir, { recursive: true });
    }
  };
}
