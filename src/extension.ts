/* eslint-disable max-classes-per-file */
import { Client } from '@replit/crosis';
import fetch, { Response } from 'node-fetch';
import { AbortSignal } from 'node-fetch/externals';
import * as vscode from 'vscode';
import ws from 'ws';
import { FS } from './fs';
import { Options } from './options';

const BAD_KEY_MSG = 'Please enter a valid crosis key';

export const isReplId = (replId: string): boolean => !!replId && replId.split('-').length === 5;

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

export async function parseRepl(repl: string): Promise<string | null> {
  // If its a repl id, we're already done
  if (isReplId(repl)) return repl;

  // Check if user included full URL using a simple regex
  const urlRegex = /(?:http(?:s?):\/\/repl\.it\/)?@(.+)\/([^?\s#]+)/g;
  const match = urlRegex.exec(repl);
  if (!match) {
    return null;
  }

  const [, user, slug] = match;

  return getReplId(user, slug);
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

/**
 * Called when the user invokes Replit: init from the command palette.
 */
const initialize = async (store: Options, ctx: vscode.ExtensionContext) => {
  const apiKey = await ensureKey(store);
  if (!apiKey) return;

  let replId: string;
  const storedId = ctx.workspaceState.get('replId');

  if (typeof storedId === 'string') {
    replId = storedId;
  } else {
    const newRepl = await vscode.window.showInputBox({
      prompt: 'Repl Name',
      placeHolder: 'Repl link, @user/repl string, or repl id',
      ignoreFocusOut: true,
    });

    if (!newRepl) return;

    let newReplId;
    try {
      newReplId = await parseRepl(newRepl);
    } catch (e) {
      vscode.window.showErrorMessage(e?.message || 'Error with no message, check console');

      // eslint-disable-next-line no-console
      console.error(e);

      return;
    }

    if (!newReplId) {
      vscode.window.showErrorMessage('Invalid repl');
      return;
    }

    await ctx.workspaceState.update('replId', newReplId);
    replId = newReplId;
  }

  console.log(`Connecting to repl ID ${JSON.stringify(replId)}...`);
  const client = new Client<vscode.ExtensionContext>();
  client.setUnrecoverableErrorHandler((e: Error) => {
    console.error(e);
    vscode.window.showErrorMessage(e.message);
  });

  console.log('Creating FS...');
  const fs = new FS(client);
  ctx.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('replit', fs, {
      isCaseSensitive: true,
    }),
  );

  client.open(
    {
      context: ctx,
      fetchToken: async (abortSignal: any) => {
        let token;
        try {
          token = await fetchToken(abortSignal, replId, apiKey);
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
    () => {
      // TODO connecting messages
    },
  );
};

export async function activate(context: vscode.ExtensionContext) {
  console.log('Extension activating...');
  const store = await Options.create();
  console.log('Initializing...');
  await initialize(store, context);

  context.subscriptions.push(
    vscode.commands.registerCommand('replit.init', () =>
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse('replit:/'),
        name: 'Repl.it',
      }),
    ),
  );
}
