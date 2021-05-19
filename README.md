
# Requirements

You must have the `developer` role on repl.it to use this extension.

# How to use

After installing this extension, bring up the command palette and paste a link to the repl (or the repl's uuid). You can open multiple repls in the same workspace.

![](https://i.imgur.com/1liRgmn.png)

If you haven't already, you will be prompted to supply an API key. You can get one from [here](https://devs.turbio.repl.co/)

Once you open a repl you can start making changes to the filesystem from the file tree and the editor.

# Filewatching

Currently, the extension does not watch the repl's filesystem, so if you, or a multiplayer collaborator, are making changes on Repl.it or programmatically (via shell or a running program), you won't see them propagate in VSCode in real-time. You can hit the refresh button in the file tree and the workspace should pick up the changes.

# Development

- `npm install`
- `npm run watch`
- Launch extension from debugger sidebar (or hit F5)

This extension uses Replit's API and the Crosis client, refer to the docs here https://crosisdoc.util.repl.co/

# Disclaimer

This extension was developed as a proof of concept and as an exploratory project. You can consider it in a pre-alpha state and it's a community-led project. Replit is not responsible for any content or security issues that may arise due to this plugin, if you do find any, feel free to open an issue or a pull request.
