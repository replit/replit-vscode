import * as vscode from 'vscode';
import { Channel } from '@replit/crosis';
import { CrosisClient } from './types';

export default class ReplitTerminal implements vscode.Pseudoterminal {
  private client: CrosisClient;

  private channel: Channel | null;

  private closeChannel: (() => void) | null;

  private dimensions: vscode.TerminalDimensions | undefined;

  private emitter: vscode.EventEmitter<string>;

  onDidWrite: vscode.Event<string>;

  constructor(client: CrosisClient) {
    this.dimensions = undefined;
    this.channel = null;
    this.closeChannel = null;
    this.client = client;

    this.emitter = new vscode.EventEmitter<string>();
    this.onDidWrite = this.emitter.event;
  }

  close(): void {
    if (this.closeChannel) {
      this.closeChannel();
    }
  }

  handleInput(input: string): void {
    if (!this.channel) {
      return;
    }

    this.channel.send({ input });
  }

  open(dimensions: vscode.TerminalDimensions | undefined): void {
    this.dimensions = dimensions;

    this.closeChannel = this.client.openChannel({ service: 'shell' }, (result) => {
      if (!result.channel) {
        return;
      }

      this.channel = result.channel;

      result.channel.onCommand((cmd) => {
        console.log(cmd.output);
        if (!cmd.output) {
          return;
        }

        this.emitter.fire(cmd.output);
      });

      if (this.dimensions) {
        result.channel.send({
          resizeTerm: {
            cols: this.dimensions.columns,
            rows: this.dimensions.rows,
          },
        });
      }
    });
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;

    if (!this.channel) {
      return;
    }

    this.channel.send({
      resizeTerm: {
        cols: dimensions.columns,
        rows: dimensions.rows,
      },
    });
  }
}
