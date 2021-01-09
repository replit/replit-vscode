/* eslint-disable max-classes-per-file */
import { Client } from '@replit/crosis';
import fetch, { Response } from 'node-fetch';
import { AbortSignal } from 'node-fetch/externals';
import * as vscode from 'vscode';
import ws from 'ws';
import { FS } from './fs';
import { Options } from './options';
// import ReplitTerminal from './shell';

const BAD_KEY_MSG = 'Please enter a valid crosis key';

// export const isReplId = (replId: string): boolean => !!replId && replId.split('-').length === 5;

async function getReplId(user: string, slug: string): Promise<string> {
  const r: Response | undefined = await fetch(`https://repl.it/data/repls/@${user}/${slug}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'ezcrosis',
      'x-requested-with': 'ezcrosis',
    },
  });

  if (r.status === 404) {
    throw new Error(
      'Repl not found, did you make a typo? ' +
        'If this is a private repl, go to ' +
        `https://repl.it/data/repls/@${user}/${slug} ` +
        'and find the part that looks like {"id": "COPY THIS"} and paste just the ID ' +
        'back in the repl prompt.',
    );
  }

  if (r.status !== 200) {
    let text;
    try {
      text = await r.text();
    } catch (e) {
      text = '';
    }
    throw new Error(
      `Got invalid status ${
        r.status
      } while fetching data for @${user}/${slug}, data: ${JSON.stringify(text)}`,
    );
  }

  const data = await r.json();

  if (data && typeof data.id === 'string') {
    return data.id;
  }

  throw new Error(`Invalid response received: ${data}`);
}

interface ReplInfo {
  id: string;
  user: string;
  slug: string;
}

export async function getReplInfo(input: string): Promise<ReplInfo> {
  // If its a repl id, we're already done
  // if (isReplId(repl)) return repl; // TODO re-add later

  // Check if user included full URL using a simple regex
  const urlRegex = /(?:http(?:s?):\/\/repl\.it\/)?@(.+)\/([^?\s#]+)/g;
  const match = urlRegex.exec(input);
  if (!match) {
    throw new Error('Please input in the format of @username/replname or full url of the repl');
  }

  const [, user, slug] = match;

  const id = await getReplId(user, slug);

  return {
    id,
    user,
    slug,
  };
}

// Simple key regex. No need to be strict here.
const validKey = (key: string): boolean => !!key && /[a-zA-Z0-9/=]+:[a-zA-Z0-9/=]+/.test(key);

/*
vscode.workspace.updateWorkspaceFolders(0, 0, {
    uri: vscode.Uri.parse("replit:/"),
    name: "random testing repl",
  }); */

const ensureKey = async (store: Options): Promise<string | null> => {
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
  const newKey = await vscode.window.showInputBox({
    prompt: 'Crosis API Key',
    placeHolder: 'Enter your api key from https://devs.turbio.repl.co',
    value: storedKey || '',
    ignoreFocusOut: true,
    validateInput: (val) => (validKey(val) ? '' : BAD_KEY_MSG),
  });

  if (newKey && validKey(newKey)) {
    await store.set({ key: newKey });
    return newKey;
  }

  return null;
};

class TokenFetchError extends Error {
  res: unknown;
}

async function fetchToken(
  abortSignal: AbortSignal,
  replId: string,
  apiKey: string,
): Promise<string> {
  const r = await fetch(`https://repl.it/api/v0/repls/${replId}/token`, {
    signal: abortSignal,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-Type': 'application/json',
      'user-agent': 'ezcrosis',
      'x-requested-with': 'ezcrosis',
    },
    body: JSON.stringify({ apiKey }),
  });
  const text = await r.text();

  let res;
  try {
    res = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON while fetching token for ${replId}: ${JSON.stringify(text)}`);
  }

  if (typeof res !== 'string') {
    const err = new TokenFetchError(`Invalid token response: ${res}`);
    err.res = res;
    throw err;
  }
  return res;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const fs = new FS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('replit', fs, {
      isCaseSensitive: true,
    }),
  );

  const openedRepls: {
    [replId: string]: {
      replInfo: ReplInfo;
      client: Client<{
        extensionContext: vscode.ExtensionContext;
        replInfo: ReplInfo;
      }>;
    };
  } = {};

  const store = await Options.create();
  let apiKey = await ensureKey(store);

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.shell', async () => {
      // TODO quick pick from opened repls
      // error if there are no opened repls
      // get client
      // create terminal with client
      //
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.openrepl', async () => {
      if (!apiKey) {
        apiKey = await ensureKey(store);
      }

      const input = await vscode.window.showInputBox({
        prompt: 'Repl Name',
        placeHolder: '@user/repl or full url to repl',
        ignoreFocusOut: true,
      });

      console.log(`getting repl.id for ${input}`);

      if (!input) {
        return vscode.window.showErrorMessage('Repl.it: please supply a valid repl url');
      }

      let replInfo: ReplInfo;
      try {
        replInfo = await getReplInfo(input);
      } catch (e) {
        console.error(e);

        return vscode.window.showErrorMessage(e?.message || 'Error with no message, check console');
      }

      console.log(`Connecting to @${replInfo.user}/${replInfo.slug}...`);

      const client = new Client<{
        extensionContext: vscode.ExtensionContext;
        replInfo: ReplInfo;
      }>();
      client.setUnrecoverableErrorHandler((e: Error) => {
        console.error(e);
        vscode.window.showErrorMessage(e.message);
      });

      openedRepls[replInfo.id] = {
        replInfo,
        client,
      };

      fs.addRepl(replInfo.id, client);

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
          if (result.channel) {
            vscode.window.showInformationMessage('Repl.it: Connected');
          }

          return ({ willReconnect }) => {
            if (willReconnect) {
              vscode.window.showWarningMessage('Repl.it: Unexpected disconnect, reconnecting...');
            } else {
              vscode.window.showWarningMessage('Repl.it: Disconnected');
            }
          };
        },
      );

      console.log(vscode.Uri.parse(`replit:/${replInfo.id}/`));

      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse(`replit:/${replInfo.id}/`),
        name: `@${replInfo.user}/${replInfo.slug}`,
      });
    }),
  );
}
