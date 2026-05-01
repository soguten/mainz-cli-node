{
    "compilerOptions": {
        "lib": ["dom", "esnext"],
        "jsx": "react-jsx",
        "jsxImportSource": "mainz",
        "strict": true
    },
    "imports": {
        "@deno/vite-plugin": "npm:@deno/vite-plugin@2.0.2",
        "mainz": "{{mainzSpecifier}}",
        "mainz/": "{{mainzSubpathPrefix}}",
        "vite": "npm:vite@7.3.1"
    },
    "tasks": {
        "dev": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} dev",
        "build": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} build",
        "preview": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} preview",
        "test": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} test",
        "publish-info": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} publish-info",
        "diagnose": "deno run -A --config {{denoConfigPath}} {{mainzCliSpecifier}} diagnose"
    }
}
