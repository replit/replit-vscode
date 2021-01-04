"use strict";

import { Client } from "@replit/crosis";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { w3cwebsocket } from "websocket";
import { FS } from "./fs";

function genConnectionMetadata() {
  const { TOKEN_SECRET } = process.env;

  if (!TOKEN_SECRET) {
    throw new Error("TOKEN_SECRET env var not found");
  }

  const opts = {
    id: `vscode-ext-wip-${Math.random().toString(36).split(".")[1]}`,
    mem: 1024 * 1024 * 512,
    thread: 0.5,
    share: 0.5,
    net: true,
    attach: true,
    bucket: "test-replit-repls",
    ephemeral: true,
    nostore: true,
    language: "bash",
    owner: true,
    path: Math.random().toString(36).split(".")[1],
    disk: 1024 * 1024 * 1024,
    bearerName: "vscoderepltwip",
    bearerId: 2,
    presenced: true,
    user: "vscoderepltwip",
    pullFiles: true,
    polygott: false,
    format: "pbuf",
  };
  const encodedOpts = Buffer.from(
    JSON.stringify({
      created: Date.now(),
      salt: Math.random().toString(36).split(".")[1],
      ...opts,
    })
  ).toString("base64");

  const hmac = crypto.createHmac("sha256", TOKEN_SECRET);
  hmac.update(encodedOpts);
  const msgMac = hmac.digest("base64");

  const token = Buffer.from(`${encodedOpts}:${msgMac}`);

  return {
    token: token.toString("base64"),
    gurl: "ws://eval.repl.it",
    conmanURL: "http://eval.repl.it",
  };
}

export function activate(context: vscode.ExtensionContext) {
  const client = new Client<vscode.ExtensionContext>();

  client.setUnrecoverableErrorHandler((e) => {
    console.error(e);
    vscode.window.showErrorMessage(e.message);
  });

  client.open(
    {
      fetchConnectionMetadata: async () => {
        // TODO actually get connection metadata through API
        return {
          ...genConnectionMetadata(),
          error: null,
        };
      },
      // @ts-ignore we don't use addEventListener removeEventListener and dispatchEvent :)
      // eslint-disable-next-line
      WebSocketClass: w3cwebsocket as WebSocket,
      context,
    },
    ({ channel }) => {
      if (channel) {
        console.log("connected");
      } else {
        console.log("error while opening");
      }
    }
  );

  const fs = new FS(client);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("replit", fs, {
      isCaseSensitive: true,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("replit.init", async () => {
      // TOOD this should accept a repl and then connect
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse("replit:/"),
        name: "random testing repl",
      });
    })
  );
}
