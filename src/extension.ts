/* eslint-disable max-classes-per-file */
import { Client } from '@replit/crosis';
import * as vscode from 'vscode';
import ws from 'ws';
import { FS } from './fs';
import { Options } from './options';
import ReplitTerminal from './shell';
import { CrosisClient, ReplInfo } from './types';
import { fetchToken, getReplInfo } from './api';

const BAD_KEY_MSG = 'Please enter a valid crosis key';

// Simple key regex. No need to be strict here.
const validKey = (key: string): boolean => !!key && /[a-zA-Z0-9/=]+:[a-zA-Z0-9/=]+/.test(key);

const ensureKey = async (
  store: Options,
  { forceNew }: { forceNew: boolean } = { forceNew: false },
): Promise<string | null> => {
  if (!forceNew) {
    let storedKey: string;
    try {
      const key = await store.get('key');
      if (typeof key === 'string') {
        storedKey = key;
      } else {
        storedKey = '';
      }
    } catch (e) {
      console.error(e);
      storedKey = '';
    }

    if (storedKey && validKey(storedKey)) {
      return storedKey;
    }
  }

  const newKey = await vscode.window.showInputBox({
    prompt: 'Crosis API Key',
    placeHolder: 'Enter your api key from https://devs.turbio.repl.co',
    value: '',
    ignoreFocusOut: true,
    validateInput: (val) => (validKey(val) ? '' : BAD_KEY_MSG),
  });

  if (newKey && validKey(newKey)) {
    await store.set({ key: newKey });
    return newKey;
  }

  return null;
};

const openedRepls: {
  [replId: string]: {
    replInfo: ReplInfo;
    client: CrosisClient;
  };
} = {};

function openReplClient(
  replInfo: ReplInfo,
  context: vscode.ExtensionContext,
  apiKey: string,
): CrosisClient {
  vscode.window.showInformationMessage(`Repl.it: connecting to @${replInfo.user}/${replInfo.slug}`);

  const client = new Client<{
    extensionContext: vscode.ExtensionContext;
    replInfo: ReplInfo;
  }>();
  client.setUnrecoverableErrorHandler((e: Error) => {
    delete openedRepls[replInfo.id];
    console.error(e);
    vscode.window.showErrorMessage(e.message);
  });

  client.open(
    {
      context: {
        extensionContext: context,
        replInfo,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchToken: async (abortSignal: any) => {
        if (!apiKey) {
          throw new Error('Repl.it: Failed to open repl, no API key provided');
        }

        let token;
        try {
          token = await fetchToken(abortSignal, replInfo.id, apiKey);
        } catch (e) {
          if (e.name === 'AbortError') {
            return { aborted: true, token: null };
          }

          throw e;
        }
        return { token, aborted: false };
      },
      // eslint-disable-next-line
      // @ts-ignore we don't use addEventListener removeEventListener and dispatchEvent :)
      WebSocketClass: ws as WebSocket,
    },
    (result) => {
      if (!result.channel) {
        return;
      }

      vscode.window.showInformationMessage(`Repl.it: @${replInfo.user}/${replInfo.slug} connected`);

      result.channel.onCommand((cmd) => {
        if (cmd.portOpen?.forwarded) {
          const panel = vscode.window.createWebviewPanel(
            'replView',
            `@${replInfo.user}/${replInfo.slug} webview`,
            vscode.ViewColumn.One,
            {},
          );

          panel.webview.html = `<!DOCTYPE html>
<head>
  <style>
   html, body, iframe {
     height: 100%;
     width: 100%;
     background: white;
     border: none;
     padding: 0;
     margin: 0;
     display: block;
   }
  </style>
</head>
  <body>
    <iframe
    sandbox="allow-forms allow-pointer-lock allow-popups allow-same-origin allow-scripts allow-modals"
    src="https://${replInfo.id}.id.repl.co"
    ><iframe>
  </body>
</html>`;
        }
      });

      return ({ willReconnect }) => {
        if (willReconnect) {
          vscode.window.showWarningMessage(
            `Repl.it: @${replInfo.user}/${replInfo.slug} unexpectedly disconnected, reconnecting...`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Repl.it: @${replInfo.user}/${replInfo.slug} connection permanently disconnected`,
          );
        }
      };
    },
  );

  openedRepls[replInfo.id] = { replInfo, client };

  return client;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = await Options.create();
  await ensureKey(store);

  const fs = new FS(async (replId) => {
    if (openedRepls[replId]) {
      return openedRepls[replId].client;
    }

    const apiKey = await ensureKey(store);

    if (!apiKey) {
      vscode.window.showErrorMessage('Expected API key');

      throw new Error('expected API key');
    }

    let replInfo: ReplInfo;
    try {
      replInfo = await getReplInfo(replId);
    } catch (e) {
      console.error(e);

      vscode.window.showErrorMessage(e.message || 'Error with no message, check console');

      throw e;
    }

    return openReplClient(replInfo, context, apiKey);
  });

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('replit', fs, {
      isCaseSensitive: true,
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((ev) => {
      ev.removed.forEach((folder) => {
        const maybeReplId = folder.uri.authority;

        if (openedRepls[maybeReplId]) {
          openedRepls[maybeReplId].client.destroy();
          delete openedRepls[maybeReplId];
        }
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.shell', async () => {
      const r = Object.values(openedRepls);
      if (r.length === 0) {
        return vscode.window.showErrorMessage('Please open a repl first');
      }

      let replId;
      if (r.length > 1) {
        const replsToPick = Object.values(openedRepls).map(
          ({ replInfo }) => `@${replInfo.user}/${replInfo.slug} ::${replInfo.id}`,
        );

        const selected = await vscode.window.showQuickPick(replsToPick, {
          placeHolder: 'Select a repl to open a shell to',
        });

        if (!selected) {
          return;
        }

        [, replId] = selected.split('::');
      } else {
        replId = r[0].replInfo.id;
      }

      const { client, replInfo } = openedRepls[replId];

      const terminal = vscode.window.createTerminal({
        name: `@${replInfo.user}/${replInfo.slug}`,
        pty: new ReplitTerminal(client),
      });

      terminal.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.apikey', async () =>
      ensureKey(store, { forceNew: true }),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.openrepl', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Repl Name',
        placeHolder: '@user/repl or full url to repl',
        ignoreFocusOut: true,
      });

      if (!input) {
        return vscode.window.showErrorMessage('Repl.it: please supply a valid repl url or id');
      }

      let replInfo: ReplInfo;
      try {
        replInfo = await getReplInfo(input);
      } catch (e) {
        console.error(e);

        return vscode.window.showErrorMessage(e.message || 'Error with no message, check console');
      }

      // Insert the workspace folder at the end of the workspace list
      // otherwise the extension gets decativated and reactivated
      const { workspaceFolders } = vscode.workspace;
      let start = 0;
      if (workspaceFolders?.length) {
        start = workspaceFolders.length;
      }

      vscode.workspace.updateWorkspaceFolders(start, 0, {
        uri: vscode.Uri.parse(`replit://${replInfo.id}/`),
        name: `@${replInfo.user}/${replInfo.slug}`,
      });
    }),
  );
}

export function deactivate(): void {
  Object.values(openedRepls).forEach(({ client, replInfo }) => {
    delete openedRepls[replInfo.id];
    client.destroy();
  });
}
