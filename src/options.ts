import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function tryStat(p: string): Promise<fs.Stats | null> {
  try {
    const result = await fs.promises.stat(p);
    return result;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null; // not found
    throw e;
  }
}

// A mapping of options to values. Uses the same format as replitcli.
// Does not cache because replitcli or another instance could modify the file and make
//  the cache invalid.
export class Options {
  configFile: string;

  static isWindows(): boolean {
    return os.platform() === 'win32';
  }

  static async getConfigDir(): Promise<string> {
    // With the exception of VSCODE_PORTABLE, this is the same code that is used by
    //  replitcli. This allows the config file to be shared between the tools.
    const HOME = os.homedir();

    const configDirectories = [
      process.env.REPLIT_CONFIG_DIR,
      process.env.VSCODE_PORTABLE,
      process.env.XDG_CONFIG_HOME,
      path.join(HOME, '.config'),
      HOME,
    ];

    for (const dir of configDirectories) {
      const stat = dir ? await tryStat(dir) : null;
      if (dir && stat && stat.isDirectory()) {
        return dir;
      }
    }

    return HOME;
  }

  static async getConfigFile(): Promise<string> {
    return path.join(await Options.getConfigDir(), '.replitcli.json');
  }

  static async create(): Promise<Options> {
    return new Options(await Options.getConfigFile());
  }

  constructor(configFile: string) {
    this.configFile = configFile;
  }

  async read(): Promise<Record<string, unknown>> {
    console.log(`Reading ${this.configFile}`);
    try {
      const data = await fs.promises.readFile(this.configFile, 'utf8');

      return JSON.parse(data);
    } catch (e) {
      console.error(e);
      await this.write({});
      return {};
    }
  }

  async write(data: unknown): Promise<void> {
    console.log(`Writing ${this.configFile}`);
    await fs.promises.writeFile(this.configFile, JSON.stringify(data, null, 2));
  }

  async get(key: string): Promise<unknown> {
    const data = await this.read();
    if (data && key in data) {
      return data[key];
    }

    return null;
  }

  async set(newData: Record<string, unknown>): Promise<void> {
    const data = await this.read();
    await this.write({ ...data, ...newData });
  }
}
