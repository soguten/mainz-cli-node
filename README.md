# mainz-cli-node

Node/npm package for the Mainz CLI.

This repository owns the npm-distributed `mainz` binary, `mainz init` for Node and Deno projects,
`mainz app create`, and `mainz dev`.

## Quick start

Install the current alpha globally:

```bash
npm install -g @mainzjs/cli-node@alpha
```

This registers both `mainz` and `mainz-cli-node`. The explicit name is a fast-path delegation
target; other CLIs can also fall back to `npx -y @mainzjs/cli-node@alpha ...`.

Initialize a new Node project:

```bash
mainz init my-mainz-app
cd my-mainz-app
npm install
```

Create an app and start the dev server:

```bash
mainz app create site
mainz dev --target site
```

Or start from a runnable starter project:

```bash
mainz init my-mainz-app --template starter
cd my-mainz-app
npm install
mainz dev --target app
```

Initialize a Deno project from the same Node-hosted CLI:

```bash
mainz init my-mainz-deno-app --runtime deno
```

`mainz app create <name>` uses the default routed scaffold. Use `--type root` for the default
root-mounted scaffold, or `--template <name|source>` for an explicit app template or template
source. `--type` and `--template` are mutually exclusive.

`--template` also accepts template sources outside the packaged catalog, including local paths,
absolute paths, `file://` URLs, and HTTP template sources.

Some app templates can declare runtime compatibility and dependencies. For example,
`mainz app create analytics --template dashboard` creates a routed dashboard app and adds Recharts
to the project manifest for the current runtime.

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
node ./bin/mainz.js init my-deno-app --runtime deno --mainz jsr:@mainz/mainz@0.1.0-alpha.36
```

Run the template prototype tests:

```bash
npm test
```

Uninstall the global CLI:

```bash
npm uninstall -g @mainzjs/cli-node
```
