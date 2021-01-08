import { Channel } from "@replit/crosis";
import { api } from "@replit/protocol";
import { EZCrosis } from "ezcrosis";
import * as vscode from "vscode";

function uriToApiPath(uri: vscode.Uri): string {
  // strip out leading slash, we can also add a dot before the slash
  return "." + uri.path;
}

function apiToVscodeFileType(type: api.File.Type): vscode.FileType {
  if (type === api.File.Type.DIRECTORY) {
    return vscode.FileType.Directory;
  }

  // Our API doesn't support symlinks and other types
  return vscode.FileType.File;
}

export class FS implements vscode.FileSystemProvider {
  private client: EZCrosis;
  private filesChan: Channel;
  private fsEventsChan: Channel;
  private snapshotsChan: Channel;
  private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

  static async create(client: EZCrosis): Promise<FS> {
    return new FS(
      client,
      await client.channel("files"),
      await client.channel("fsevents"),
      await client.channel("snapshots")
    );
  }

  constructor(
    client: EZCrosis,
    filesChan: Channel,
    fsEventsChan: Channel,
    snapshotsChan: Channel
  ) {
    this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    this.onDidChangeFile = this.emitter.event;

    this.client = client;
    this.filesChan = filesChan;
    this.fsEventsChan = fsEventsChan;
    this.snapshotsChan = snapshotsChan;

    // TODO open fsevents and snapshots
  }

  // What is this for?
  // async copy() {}

  watch(uri: vscode.Uri): vscode.Disposable {
    console.log("watch", uri.path);
    // What is this for?
    return new vscode.Disposable(() => {
      // The following 6 lines are to make typescript shut up
      if (this.fsEventsChan) {
        if (this.snapshotsChan) {
          if (this.client) {
          }
        }
      }
    });
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    console.log("createDirectory", uri.path);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log("readDirectory", uri.path);
    const res = await this.filesChan.request({
      readdir: { path: uriToApiPath(uri) },
    });

    if (res.channelClosed) {
      // TODO handle properly
      throw vscode.FileSystemError.Unavailable(uri);
    }

    if (res.error) {
      console.error(res.error);
      // TODO parse res.error
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (!res.files?.files) {
      throw new Error("expected files.files");
    }

    // TODO do we subscribeFile here?

    return res.files.files.map(({ path, type }) => [
      path,
      apiToVscodeFileType(type),
    ]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const res = await this.filesChan.request({
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
      throw new Error("Expected file");
    }

    return res.file.content;
  }

  async delete(uri: vscode.Uri): Promise<void> {
    console.log("delete", uri.path);

    throw vscode.FileSystemError.FileNotFound();
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    console.log("rename", oldUri.path, newUri.path, options);

    throw vscode.FileSystemError.FileNotFound();
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log("stat", uri.path);
    const res = await this.filesChan.request({
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
      throw new Error("expected stat result");
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
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    console.log(
      "writeFile",
      uri.path,
      Buffer.from(content).toString("utf8"),
      options
    );
    const { statRes } = await this.filesChan.request({
      stat: { path: uriToApiPath(uri) },
    });

    if (!statRes) {
      throw new Error("expected stat result");
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

    const res = await this.filesChan.request({
      write: { path: uriToApiPath(uri), content: content },
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
