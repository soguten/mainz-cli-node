# mainz-cli-node

Node/npm package for the Mainz CLI.

This repository intentionally keeps Node-specific CLI concerns separate from the Deno-first Mainz
repository.

Current ownership in this repository:

- global `mainz` binary for npm installs
- `mainz init` for Node and Deno projects
- `mainz app create` for Node projects
- `mainz dev` for Node projects

Other commands are still delegated to `@mainz/cli-node` until their Node-specific behavior is
moved here.

The repository also contains the first Node-specific template prototype under `templates/`. The
direction here is intentionally simple:

- templates are real files
- each template has a tiny `template.json`
- the engine only copies files and replaces `{{token}}` placeholders
- there is no DSL, no base/runtime layering, and no multi-runtime composition in this repository

## Quick start

Install the current alpha globally:

```bash
npm install -g @mainzjs/cli-node@alpha
```

Initialize a new Node project:

```bash
mkdir my-mainz-app
cd my-mainz-app
mainz init
npm install
```

Create an app and start the dev server:

```bash
mainz app create site
mainz dev --target site
```

Initialize a Deno project from the same Node-hosted CLI:

```bash
mkdir my-mainz-deno-app
cd my-mainz-deno-app
mainz init --runtime deno
```

## Development

Install dependencies:

```bash
npm install
```

Run the CLI locally:

```bash
node ./bin/mainz.js --help
```

Create a new Node project:

```bash
node ./bin/mainz.js init --mainz npm:@jsr/mainz__mainz@0.1.0-alpha.36
node ./bin/mainz.js app create site
npm install
node ./bin/mainz.js dev --target site
```

Create a new Deno project from the same Node-hosted CLI:

```bash
node ./bin/mainz.js init --runtime deno --mainz jsr:@mainz/mainz@0.1.0-alpha.36
```

Run the template prototype tests:

```bash
npm test
```

Uninstall the global CLI:

```bash
npm uninstall -g @mainzjs/cli-node
```
