{
    "name": "{{projectName}}",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "mainz dev",
        "build": "mainz build",
        "preview": "mainz preview",
        "test": "mainz test",
        "diagnose": "mainz diagnose"
    },
    "dependencies": {
        "mainz": "{{mainzSpecifier}}"
    },
    "devDependencies": {
        "vite": "^7.3.1"
    },
    "workspaces": [
        "./app"
    ]
}
