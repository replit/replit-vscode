Open this repo in vscode:

- Add `TOKEN_SECRET` env var (alternatively you can modify `extension.ts` to be supplied a hardcoded token)
- `npm install`
- `npm run watch`
- Hit f5 (or whatever your launch hotkey is)
- A new vscode should launch with the extension enabled
- Hit ctrl+shift+p, run `Replit init`

# TODOS for launch:
- fs watch and notifiers
- fs delete
- fs createDirectory
- fs rename/move
- fs snapshot
- auth & connecting to a arbitrary repls
- status toasts
- proper ReadMe

Future:
- add replit shell to vscode terminal
- running repls through `shellrun2` service
- port forwarding through `socket` service

