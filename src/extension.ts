"use strict";

import { Client } from "@replit/crosis";
import fetch, { Response } from "node-fetch";
import { AbortSignal } from "node-fetch/externals";
import * as vscode from "vscode";
import ws from "ws";
import { FS } from "./fs";
import { Options } from "./options";

const BAD_KEY_MSG = "Please enter a valid crosis key";
const REPL_NOT_FOUND_MSG = (err: ReplNotFoundError) =>
  "Repl not found, did you make a typo? " +
  "If this is a private repl, go to " +
  `https://repl.it/data/repls/@${err.user}/${err.repl} ` +
  `and find the part that looks like {"id": "COPY THIS"} and paste just the ID ` +
  `back in the repl prompt.`;

const eToString = (e: any) => (e && e.stack ? e.stack : e);

export const isReplId = (replId: string): boolean =>
  !!replId && replId.split("-").length === 5;

export class ReplNotFoundError extends Error {
  user: string;
  repl: string;
}

export const performDataRequest = async (
  user: string,
  repl: string
): Promise<any> => {
  let r: Response | undefined = undefined;
  try {
    r = await fetch(`https://repl.it/data/repls/@${user}/${repl}`, {
      headers: {
        accept: "application/json",
        "user-agent": "ezcrosis",
        "x-requested-with": "ezcrosis",
      },
    });
    if (r && r.status !== 200) {
      let text;
      try {
        text = await r.text();
      } catch (e) {
        text = "";
      }
      throw new Error(
        `Got invalid status ${
          r.status
        } while fetching data for @${user}/${repl}, data: ${JSON.stringify(
          text
        )}`
      );
    }
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `Invalid JSON while fetching data for @${user}/${repl}: ${JSON.stringify(
          text
        )}`
      );
    }

    return data;
  } catch (e) {
    if (r && r.status === 404) {
      const err = new ReplNotFoundError("Repl not found");
      err.user = user;
      err.repl = repl;
    }
    throw e;
  }
};

export async function getReplId(user: string, slug: string): Promise<string> {
  const data = await performDataRequest(user, slug);

  if (data && data.id && typeof data.id === "string") {
    return data.id;
  }

  throw new Error(`Invalid response received: ${data}`);
}

export async function parseRepl(
  repl: string,
  replIdGetter: (user: string, slug: string) => Promise<string> = getReplId
): Promise<string | null> {
  // If its a repl id, we're already done
  if (isReplId(repl)) return repl;

  // Check if user included full URL using a simple regex
  const urlRegex = /http(?:s?):\/\/repl\.it\/(.+)/g;
  const match = urlRegex.exec(repl);
  if (match) repl = match[1]; // the first group

  // Split user/author
  const parts = repl.split("/");
  if (parts.length !== 2) return null;
  let [user, slug] = parts;

  // Strip out @ from beginning of user
  if (user[0] === "@") user = user.slice(1);
  // user might include the full repl URL with #filename, strip that out
  slug = slug.split("#")[0];

  return await replIdGetter(user, slug);
}

// Simple key regex. No need to be strict here.
const validKey = (key: string): boolean =>
  !!key && /[a-zA-Z0-9\/=]+:[a-zA-Z0-9\/=]+/.test(key);

/*
vscode.workspace.updateWorkspaceFolders(0, 0, {
    uri: vscode.Uri.parse("replit:/"),
    name: "random testing repl",
  });*/

const ensureKey = async (store: Options): Promise<string | null> => {
  let nullableStoredKey: string | null;
  try {
    nullableStoredKey = await store.get("key");
  } catch (e) {
    console.error(e);
    nullableStoredKey = null;
  }
  // Ensure that the key is a string and not just arbitrary JSON
  const storedKey: string =
    typeof nullableStoredKey === "string" ? nullableStoredKey || "" : "";

  if (storedKey && validKey(storedKey)) {
    return storedKey;
  } else {
    const newKey = await vscode.window.showInputBox({
      prompt: "Crosis API Key",
      placeHolder: "Enter your api key from https://devs.turbio.repl.co",
      value: storedKey || "",
      ignoreFocusOut: true,
      validateInput: (val) => (validKey(val) ? "" : BAD_KEY_MSG),
    });

    if (newKey && validKey(newKey)) {
      await store.set({ key: newKey });
      return newKey;
    }

    return null;
  }
};

class TokenFetchError extends Error {
  res: unknown;
}

async function fetchToken(
  abortSignal: AbortSignal,
  replId: string,
  apiKey: string
): Promise<string> {
  const r = await fetch(`https://repl.it/api/v0/repls/${replId}/token`, {
    signal: abortSignal,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-Type": "application/json",
      "user-agent": "ezcrosis",
      "x-requested-with": "ezcrosis",
    },
    body: JSON.stringify({ apiKey }),
  });
  const text = await r.text();

  let res;
  try {
    res = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON while fetching token for ${replId}: ${JSON.stringify(text)}`
    );
  }

  if (!res || (res as any).status !== 200 || typeof res !== "string") {
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
  let storedId = ctx.workspaceState.get("replId");

  if (typeof storedId === "string") {
    replId = storedId;
  } else {
    const newRepl = await vscode.window.showInputBox({
      prompt: "Repl Name",
      placeHolder: "Repl link, @user/repl string, or repl id",
      ignoreFocusOut: true,
    });

    if (!newRepl) return;

    let newReplId;
    try {
      newReplId = await parseRepl(newRepl);
    } catch (e) {
      const msg =
        e instanceof ReplNotFoundError ? REPL_NOT_FOUND_MSG : eToString(e);
      vscode.window.showErrorMessage(msg);
      return;
    }

    if (!newReplId) {
      vscode.window.showErrorMessage("Invalid repl");
      return;
    }

    await ctx.workspaceState.update("replId", newReplId);
    replId = newReplId;
  }

  console.log(`Connecting to repl ID ${JSON.stringify(replId)}...`);
  const client = new Client<vscode.ExtensionContext>();
  client.setUnrecoverableErrorHandler((e: Error) => {
    console.error(e);
    vscode.window.showErrorMessage(e.message);
  });

  client.open(
    {
      context: ctx,
      fetchToken: async (abortSignal: any) => {
        let token;
        try {
          token = await fetchToken(abortSignal, apiKey, replId);
        } catch (e) {
          if (e.name === "AbortError") {
            return { aborted: true, token: null };
          }
          throw e;
        }
        return { token, aborted: false };
      },
      // @ts-ignore we don't use addEventListener removeEventListener and dispatchEvent :)
      // eslint-disable-next-line
      WebSocketClass: ws as WebSocket,
    },
    () => {
      (async () => {
        console.log("Creating FS...");
        const fs = new FS(client);

        vscode.workspace.registerFileSystemProvider("replit", fs, {
          isCaseSensitive: true,
        });

        vscode.workspace.updateWorkspaceFolders(0, 0, {
          uri: vscode.Uri.parse("replit:/"),
          name: `Repl.it ${replId}`,
        });
      })();
    }
  );
};

export async function activate(context: vscode.ExtensionContext) {
  console.log("Creating options...");
  const store = await Options.create();

  context.subscriptions.push(
    vscode.commands.registerCommand("replit.init", () =>
      initialize(store, context)
    )
  );
}
