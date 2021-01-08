"use strict";

import { EZCrosis, parseRepl, ReplNotFoundError } from "ezcrosis";
import * as vscode from "vscode";
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

// Simple key regex. No need to be strict here.
const validKey = (key: string): boolean =>
  !!key && /[a-zA-Z0-9\/=]+:[a-zA-Z0-9\/=]+/.test(key);

const makeClient = (): EZCrosis => {
  const crosis = new EZCrosis();

  crosis.client.setUnrecoverableErrorHandler((e: Error) => {
    console.error(e);
    vscode.window.showErrorMessage(e.message);
  });

  return crosis;
};

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
  const client = new EZCrosis();
  client.connect(replId, apiKey);

  console.log("Creating FS...");
  const fs = await FS.create(client);

  vscode.workspace.registerFileSystemProvider("replit", fs, {
    isCaseSensitive: true,
  });

  vscode.workspace.updateWorkspaceFolders(0, 0, {
    uri: vscode.Uri.parse("replit:/"),
    name: `Repl.it ${replId}`,
  });
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
