import { Channel, Client } from '@replit/crosis';
import { api } from '@replit/protocol';
import * as vscode from 'vscode';

function uriToApiPath(uri: vscode.Uri): string {
  // strip out leading slash, we can also add a dot before the slash
  return `.${uri.path}`;
}

function apiToVscodeFileType(type: api.File.Type): vscode.FileType {
  if (type === api.File.Type.DIRECTORY) {
    return vscode.FileType.Directory;
  }

  // Our API doesn't support symlinks and other types
  return vscode.FileType.File;
}

export class FS implements vscode.FileSystemProvider {
  private filesChanPromise: Promise<Channel>;

  private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

  constructor(client: Client<vscode.ExtensionContext>) {
    let resolveFilesChan: (filesChan: Channel) => void;
    this.filesChanPromise = new Promise((r) => {
      resolveFilesChan = r;
    });
    // TODO gcsfiles
    client.openChannel({ service: 'files' }, ({ channel }) => {
      if (!channel) {
        return;
      }

      resolveFilesChan(channel);

      return () => {
        this.filesChanPromise = new Promise((r) => {
          resolveFilesChan = r;
        });
      };
    });

    this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    this.onDidChangeFile = this.emitter.event;

    // TODO open fsevents and snapshots
  }

  // What is this for?
  // async copy() {}

  // eslint-disable-next-line class-methods-use-this
  watch(uri: vscode.Uri): vscode.Disposable {
    console.log('watch', uri.path);
    // What is this for?
    return new vscode.Disposable(() => {});
  }

  // eslint-disable-next-line class-methods-use-this
  async createDirectory(uri: vscode.Uri): Promise<void> {
    console.log('createDirectory', uri.path);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log('readDirectory', uri.path);
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      readdir: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      // TODO handle properly
      throw vscode.FileSystemError.Unavailable(uri);
    }

    if (res.error) {
      // TODO parse res.error
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (!res.files?.files) {
      throw new Error('expected files.files');
    }

    // TODO do we subscribeFile here?

    return res.files.files.map(({ path, type }) => [path, apiToVscodeFileType(type)]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      read: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      // TODO handle properly
      throw vscode.FileSystemError.Unavailable(uri);
    }

    if (res.error) {
      // TODO parse res.error
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (!res.file || !res.file.path || !res.file.content) {
      throw new Error('Expected file');
    }

    return res.file.content;
  }

  // eslint-disable-next-line class-methods-use-this
  async delete(uri: vscode.Uri): Promise<void> {
    console.log('delete', uri.path);

    throw vscode.FileSystemError.FileNotFound();
  }

  // eslint-disable-next-line class-methods-use-this
  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    console.log('rename', oldUri.path, newUri.path, options);

    throw vscode.FileSystemError.FileNotFound();
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log('stat', uri.path);
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      stat: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      // TODO handle properly
      throw vscode.FileSystemError.Unavailable(uri);
    }

    if (res.error) {
      throw new Error(res.error);
    }

    if (!res.statRes) {
      throw new Error('expected stat result');
    }

    if (!res.statRes.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    return {
      type: apiToVscodeFileType(res.statRes.type),
      size: Number(res.statRes.size),
      mtime: res.statRes.modTime * 1000,
      // TODO we don't have ctime
      ctime: res.statRes.modTime * 1000,
    };
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    console.log('writeFile', uri.path, Buffer.from(content).toString('utf8'), options);
    const filesChannel = await this.filesChanPromise;
    const { statRes } = await filesChannel.request({
      stat: { path: uriToApiPath(uri) },
    });

    if (!statRes) {
      throw new Error('expected stat result');
    }

    if (statRes.exists && statRes.type === api.File.Type.DIRECTORY) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    if (!statRes.exists && !options.create) {
      // Doesn't have create option but file is not found
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (statRes.exists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    const res = await filesChannel.request({
      write: { path: uriToApiPath(uri), content },
    });

    if (res.channelClosed) {
      // TODO handle properly
      throw vscode.FileSystemError.Unavailable(uri);
    }

    if (res.error) {
      // TODO parse res.error
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // TODO emit vscode.FileChangeType.Created and vscode.FileChangeType.Changed
  }
}
