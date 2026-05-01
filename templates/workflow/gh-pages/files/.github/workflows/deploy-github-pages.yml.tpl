name: Deploy to GitHub Pages

{{triggerBlock}}

permissions:
    contents: read
    pages: write
    id-token: write

concurrency:
    group: pages
    cancel-in-progress: true

jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - name: Checkout
              uses: actions/checkout@v4

            - name: Setup Deno
              uses: denoland/setup-deno@v2
              with:
                  deno-version: v2.x

{{buildSteps}}

            - name: Resolve publish metadata and assemble Pages artifact
              id: publish
              shell: bash
              run: |
{{metadataCommands}}
{{metadataEchoes}}
{{artifactCommands}}
                  staging_dir="_pages"

                  rm -rf "$staging_dir"
                  mkdir -p "$staging_dir"
{{stagingCommands}}

                  echo "artifact_dir=$staging_dir" >> "$GITHUB_OUTPUT"

            - name: Upload Pages artifact
              uses: actions/upload-pages-artifact@v3
              with:
                  path: ${{ steps.publish.outputs.artifact_dir }}

    deploy:
        needs: build
        runs-on: ubuntu-latest
        environment:
            name: github-pages
            url: ${{ steps.deployment.outputs.page_url }}
        steps:
            - name: Deploy to GitHub Pages
              id: deployment
              uses: actions/deploy-pages@v4
