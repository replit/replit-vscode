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

function handleError(errStr: string, uri: vscode.Uri): null {
  if (!errStr) {
    return null;
  }

  if (errStr.includes('no such file or directory')) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  if (errStr.includes('not a directory')) {
    throw vscode.FileSystemError.FileNotADirectory(uri);
  }

  if (errStr.includes('is a directory')) {
    throw vscode.FileSystemError.FileIsADirectory(uri);
  }

  if (errStr.includes('file exist')) {
    throw vscode.FileSystemError.FileExists(uri);
  }

  // Unknown error
  throw new Error(errStr);
}

export class FS implements vscode.FileSystemProvider {
  private filesChanPromise: Promise<Channel>;

  private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

  constructor(client: Client<vscode.ExtensionContext>) {
    let resolveFilesChan: (filesChan: Channel) => void;
    let reject: (e: vscode.FileSystemError) => void;
    this.filesChanPromise = new Promise((res, rej) => {
      resolveFilesChan = res;
      reject = rej;
    });
    // TODO gcsfiles
    client.openChannel({ service: 'files' }, (result) => {
      if (result.error) {
        reject(vscode.FileSystemError.Unavailable());

        return;
      }

      resolveFilesChan(result.channel);

      return ({ willReconnect }) => {
        if (!willReconnect) {
          reject(vscode.FileSystemError.Unavailable());
        }

        this.filesChanPromise = new Promise((res, rej) => {
          resolveFilesChan = res;
          reject = rej;
        });
      };
    });

    this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    this.onDidChangeFile = this.emitter.event;

    // TODO open fsevents and snapshots
  }

  // This is called when we want to retry after we get channelClosed
  // eslint-disable-next-line class-methods-use-this
  private async callSoon<Fn extends (...args: never[]) => Promise<any>>(
    fn: Fn,
    ...params: Parameters<Fn>
  ): Promise<ReturnType<Fn>> {
    // We will re-call the function when the channel opens
    // we add a timeout to allow for the filesChanPromise to be regenerated
    // in the clean up callback as the cleanup callback is called after the
    // request is resolved with `channelClosed`.
    // i.e.
    // 1. https://github.com/replit/crosis/blob/763a1ec/src/client.ts#L1213-L1216
    // 2. https://github.com/replit/crosis/blob/763a1ec/src/channel.ts#L169-L170 (we got res.channelClosed here)
    // 3. https://github.com/replit/crosis/blob/763a1ec/src/client.ts#L1247-L1250 (filesChanPromise is reset here)
    // 4. Our timeout
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        fn(...params)
          .then(resolve)
          .catch(reject);
      }, 0);
    });
  }

  // What is this for?
  // async copy() {}

  watch(uri: vscode.Uri): vscode.Disposable {
    console.log('watch', uri.path);
    // What is this for?
    return {
      dispose: () => {},
    };
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      mkdir: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      return this.callSoon(this.createDirectory, uri);
    }

    handleError(res.error, uri);

    // emit vscode.FileChangeType.Created
    // emit vscode.FileChangeType.Changed on parent
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log('readDirectory', uri.path);
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      readdir: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      return this.callSoon(this.readDirectory, uri);
    }

    handleError(res.error, uri);

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
      return this.callSoon(this.readFile, uri);
    }

    handleError(res.error, uri);

    if (!res.file || !res.file.path || !res.file.content) {
      throw new Error('Expected file');
    }

    return res.file.content;
  }

  async delete(uri: vscode.Uri, _options: { recursive: boolean }): Promise<void> {
    // Ignoring recursive option for now. I'm not sure when vscode would
    // ask us to delete a directory non-recursively, and what is the correct
    // behavior if the directory has contents and we don't have a recursive option
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      remove: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      return this.callSoon(this.delete, uri, _options);
    }

    handleError(res.error, uri);

    // TODO
    // emit vscode.FileChangeType.Changed for parent directory
    // emit vscode.FileChangeType.Deleted
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    console.log('rename', oldUri.path, newUri.path);
    if (uriToApiPath(oldUri) === uriToApiPath(newUri)) {
      return;
    }

    const filesChannel = await this.filesChanPromise;

    // replicate behaviour from vscode
    // https://github.com/microsoft/vscode/blob/f4ab083c28ef1943c6636b8268e698bfc8614ee8/src/vs/platform/files/node/diskFileSystemProvider.ts#L436
    // if the file exists:
    // - overwrite is false, we throw an exists error
    // - overwrite: is true, delete the file before moving
    const statResponse = await filesChannel.request({
      stat: { path: uriToApiPath(newUri) },
    });

    if (statResponse.channelClosed) {
      return this.callSoon(this.rename, oldUri, newUri, options);
    }

    const { statRes: statResult } = statResponse;

    if (!statResult) {
      throw new Error('expected stat result');
    }

    if (statResult.exists) {
      if (!options.overwrite) {
        throw vscode.FileSystemError.FileExists(newUri);
      }

      await this.delete(newUri, { recursive: true });
    }

    const res = await filesChannel.request({
      move: { oldPath: uriToApiPath(oldUri), newPath: uriToApiPath(newUri) },
    });

    if (statResponse.channelClosed) {
      return this.callSoon(this.rename, oldUri, newUri, options);
    }

    handleError(res.error, oldUri);

    // TODO
    // vscode.FileChangeType.Deleted oldUri
    // vscode.FileChangeType.Created newUri
    // vscode.FileChangeType.Changed newUri and oldUri parents
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log('stat', uri.path);
    const filesChannel = await this.filesChanPromise;
    const res = await filesChannel.request({
      stat: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      return this.callSoon(this.stat, uri);
    }

    handleError(res.error, uri);

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

    // Replit's api for `write` always creates and overwrites, where as vscode expects us
    // to validate the existence of the file based on these options.
    // Based off https://github.com/microsoft/vscode/blob/f4ab083c28ef1943c6636b8268e698bfc8614ee8/src/vs/platform/files/node/diskFileSystemProvider.ts#L176-L189
    const statResponse = await filesChannel.request({
      stat: { path: uriToApiPath(uri) },
    });

    if (statResponse.channelClosed) {
      return this.callSoon(this.writeFile, uri, content, options);
    }

    const { statRes: statResult } = statResponse;

    if (!statResult) {
      throw new Error('expected stat result');
    }

    if (statResult.exists && statResult.type === api.File.Type.DIRECTORY) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    if (!statResult.exists && !options.create) {
      // Doesn't have create option but file is not found
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (statResult.exists && !options.overwrite) {
      // No overwrite option, but the file exists
      throw vscode.FileSystemError.FileExists(uri);
    }

    const res = await filesChannel.request({
      write: { path: uriToApiPath(uri), content },
    });

    if (res.channelClosed) {
      return this.callSoon(this.writeFile, uri, content, options);
    }

    handleError(res.error, uri);

    // TODO
    // if options.create emit vscode.FileChangeType.Created
    // if options.create emit vscode.FileChangeType.Changed on parent
    // emit vscode.FileChangeType.Changed
  }
}
