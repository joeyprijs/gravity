# Security Policy

Gravity is a **browser-native, zero-dependency** engine with no backend and no
build pipeline. There is no server to attack and no package supply chain to
compromise. That said, a few things are worth understanding before you ship a
game built with Gravity, and we welcome reports of anything we've missed.

## Trust Model

Gravity treats a game's own content as **trusted, first-party data**. Two
channels execute or render that trust directly:

1. **Plugins.** Any module listed in `data/index.json` under `plugins` is
   dynamically `import()`-ed at boot and runs with full engine access. Only load
   manifests and plugins you trust. Treat third-party game packs as untrusted
   code — loading one is equivalent to running its JavaScript.
2. **Scene description bodies.** Scene `description` text is rendered as HTML so
   authors can use simple markup. All *other* dynamic values (item names, player
   input, etc.) are escaped and rendered as plain text. Do not paste untrusted
   text into a scene description body.

Save files are Base64-encoded JSON loaded entirely on the player's own machine.
The engine validates a save's basic shape before applying it, but a save file is
still author/player data — do not load save files from sources you don't trust.

## Supported Versions

The project is released into the public domain and maintained on a best-effort
basis. Security fixes are applied to the `main` branch.

## Reporting a Vulnerability

If you believe you've found a security issue — for example a cross-site
scripting (XSS) vector reachable from ordinary game data rather than a plugin or
scene body — please report it privately:

- **Email:** joey@eet.nu
- Or open a [GitHub security advisory](https://github.com/joeyprijs/gravity/security/advisories/new).

Please include reproduction steps and the affected file(s). We'll acknowledge
your report and work with you on a fix. Please give us a reasonable window to
address the issue before any public disclosure.
