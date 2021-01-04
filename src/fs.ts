import * as vscode from 'vscode';
import { Channel, Client } from '@replit/crosis';

export class FS implements vscode.FileSystemProvider {
  private filesChanPromise: Promise<Channel>;
  private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;

  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

  constructor(client: Client<vscode.ExtensionContext>) {
    let resolveFilesChan: (filesChan: Channel) => void;
    this.filesChanPromise = new Promise((r) => (resolveFilesChan = r));
    client.openChannel({ service: 'files' }, ({ channel }) => {
      if (!channel) {
        return;
      }

      resolveFilesChan(channel);

      return () => {
        this.filesChanPromise = new Promise((r) => (resolveFilesChan = r));
      };
    });

    this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    this.onDidChangeFile = this.emitter.event;
  }

  // What is this for?
  // async copy() {}

  watch(uri: vscode.Uri): vscode.Disposable {
    console.log('watch', uri.path);
  }
  
  async createDirectory(uri: vscode.Uri): Promise<void> {
    console.log('createDirectory', uri.path);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log('readDirectory', uri.path);
  }


  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    console.log('readFile', uri.path);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    console.log('delete', uri.path);
  }


  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    console.log('rename', oldUri.path, newUri.path, options);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log('stat', uri.path);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
    console.log('writeFile', uri.path, Buffer.from(content).toString('utf8'), options);
  }



}
