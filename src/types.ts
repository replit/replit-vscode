import { Client } from '@replit/crosis';
import * as vscode from 'vscode';

export interface ReplInfo {
  id: string;
  user: string;
  slug: string;
}

export type CrosisClient = Client<{
  extensionContext: vscode.ExtensionContext;
  replInfo: ReplInfo;
}>;
