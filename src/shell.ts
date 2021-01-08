import * as vscode from 'vscode';
import { Channel, Client } from '@replit/crosis';

export default class ReplitTerminal implements vscode.Pseudoterminal {
  private client: Client<vscode.ExtensionContext>;
  private channel: Channel | null;
  private dimensions: vscode.TerminalDimensions | undefined;
  private emitter: vscode.EventEmitter<string>;
  onDidWrite: vscode.Event<string>;

  constructor(client: Client<vscode.ExtensionContext>) {
    this.dimensions = undefined;
    this.channel = null;
    this.client = client;

    this.emitter = new vscode.EventEmitter<string>();
    this.onDidWrite = this.emitter.event;
  }

  close() {}

  handleInput(input: string) {
    console.log('input', input, !!this.channel);
    if (!this.channel) {
      return;
    }

    this.channel.send({ input });
  }

  open(dimensions: vscode.TerminalDimensions | undefined) {
    console.log('open');
    this.dimensions = dimensions;

    this.client.openChannel({ service: 'shell' }, (result) => {
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

  setDimensions(dimensions: vscode.TerminalDimensions) {
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
