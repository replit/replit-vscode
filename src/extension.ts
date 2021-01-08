"use strict";

import { EZCrosis } from "ezcrosis";
import * as vscode from "vscode";
import { Options } from "./options";

const BAD_KEY_MSG = "Please enter a valid crosis key";

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
  const key = await ensureKey(store);
  if (!key) return;

  const repl = ctx.workspaceState.get("replId");
  if (!repl) {
    const newRepl = await vscode.window.showInputBox({
      prompt: "Repl Name",
      placeHolder: "@user/repl or repl id",
      ignoreFocusOut: true,
    });

    if (newRepl) {
      console.log(newRepl);
    }
  }

  /*vscode.workspace.registerFileSystemProvider("replit", fs, {
    isCaseSensitive: true,
  });

  vscode.workspace.updateWorkspaceFolders(0, 0, {
    uri: vscode.Uri.parse("replit:/"),
    name: "random testing repl",
  });*/
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
