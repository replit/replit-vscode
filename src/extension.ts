/* eslint-disable max-classes-per-file */
import { Client } from '@replit/crosis';
import fetch from 'node-fetch';
import { AbortSignal } from 'node-fetch/externals';
import * as vscode from 'vscode';
import ws from 'ws';
import { GraphQLClient, gql } from 'graphql-request';
import { FS } from './fs';
import { Options } from './options';
// import ReplitTerminal from './shell';

const gqlClient = new GraphQLClient('https://repl.it/graphql/', {});
gqlClient.setHeaders({
  'X-Requested-With': 'graph',
  'user-agent': 'lol',
  referrer: 'https://repl.it',
});

const ReplInfoFromUrlDoc = gql`
  query ReplInfoFromUrl($url: String!) {
    repl(url: $url) {
      ... on Repl {
        id
        user {
          username
        }
        slug
      }
    }
  }
`;

const ReplInfoFromIdDoc = gql`
  query ReplInfoFromUrl($id: String!) {
    repl(id: $id) {
      ... on Repl {
        id
        user {
          username
        }
        slug
      }
    }
  }
`;

interface ReplInfo {
  id: string;
  user: string;
  slug: string;
}

const BAD_KEY_MSG = 'Please enter a valid crosis key';

async function getReplInfoByUrl(url: string): Promise<ReplInfo> {
  const result = await gqlClient.request(ReplInfoFromUrlDoc, { url });

  if (!result.repl) {
    throw new Error('unexpected grqphql response for url');
  }

  return {
    id: result.repl.id,
    user: result.repl.user.username,
    slug: result.repl.slug,
  };
}

async function getReplInfoById(id: string): Promise<ReplInfo> {
  const result = await gqlClient.request(ReplInfoFromIdDoc, { id });

  if (!result.repl) {
    throw new Error('unexpected grqphql response for url');
  }

  return {
    id: result.repl.id,
    user: result.repl.user.username,
    slug: result.repl.slug,
  };
}

export async function getReplInfo(input: string): Promise<ReplInfo> {
  if (input.split('-').length === 5) {
    return getReplInfoById(input);
  }

  // Check if user included full URL using a simple regex
  const urlRegex = /(?:http(?:s?):\/\/repl\.it\/)?@(.+)\/([^?\s#]+)/g;
  const match = urlRegex.exec(input);
  if (!match) {
    throw new Error('Please input in the format of @username/replname or full url of the repl');
  }

  const [, user, slug] = match;

  return getReplInfoByUrl(`https://repl.it/@${user}/${slug}`);
}

// Simple key regex. No need to be strict here.
const validKey = (key: string): boolean => !!key && /[a-zA-Z0-9/=]+:[a-zA-Z0-9/=]+/.test(key);

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
    const err = new TokenFetchError(`Invalid token response: ${JSON.stringify(res)}`);
    err.res = res;
    throw err;
  }
  return res;
}

function openReplClient(
  replInfo: ReplInfo,
  context: vscode.ExtensionContext,
  apiKey: string,
): Client<any> {
  console.log(`Connecting to @${replInfo.user}/${replInfo.slug}...`);

  const client = new Client<{
    extensionContext: vscode.ExtensionContext;
    replInfo: ReplInfo;
  }>();
  client.setUnrecoverableErrorHandler((e: Error) => {
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

  return client;
}

const openedRepls: {
  [replId: string]: {
    replInfo: ReplInfo;
    client: Client<{
      extensionContext: vscode.ExtensionContext;
      replInfo: ReplInfo;
    }>;
  };
} = {};

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
      const apiKey = await ensureKey(store);

      if (!apiKey) {
        throw new Error('expected API key');
      }

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

      const client = openReplClient(replInfo, context, apiKey);

      openedRepls[replInfo.id] = { replInfo, client };

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
  Object.values(openedRepls).forEach(({ client }) => {
    client.destroy();
  });
}
