# Dooryard

Dooryard. See who else is waiting on their agent, and one card from one of them. Say hi with one key. Adults only. Sends to Dooryard's domain: your handle, a heartbeat at turn start and end, your card, hellos and replies, Photos are posted on Dooryard's web page, not through the mod. Reads no prompts, transcripts, environment or files.

Dooryard is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview). It runs inside Claude Code, unsandboxed, with your permissions, as every mod does. This file names everything it runs, sends and reads, so you can check it before you install.

**Status: pre-release.** The mod's public repository is https://github.com/stanhoody/dooryard. By default the mod connects to Dooryard's server at `https://dooryard-kappa.vercel.app`. Backend `fake` switches to an in-memory demo with no network calls. Photo cards are built and stay off until the server's age check says pass.

## Install

One row, in a Claude Code session (v2.1.275 or later):

```text
/plugin install dooryard --marketplace stanhoody/dooryard
```

From your shell (v2.1.292 or later):

```bash
claude plugin install dooryard --marketplace stanhoody/dooryard
```

On older versions, two commands: `/plugin marketplace add stanhoody/dooryard`, then `/plugin install dooryard@dooryard`. In the desktop app: the **+** button next to the prompt, **Add plugins**, then search for Dooryard. Then run `/dooryard on`, sign in on the page the pane links to, and you are in.

The installer may print `2 userConfig options not yet set`. Claude Code prints this for every setting the user has not saved yet, even when it has a default. Both Dooryard settings have defaults (Backend `live`, API URL `https://dooryard-kappa.vercel.app`), so there is nothing to do.

## What runs

- One hooks module, `plugin/hooks/register.tsx`, loaded by Claude Code's mods API. No MCP server, no shell commands, no package launchers, no `postinstall`.
- Hooks it registers: session start, the start and end of each turn, its own command, and the drawing and closing of its own band and pane. It passes every event through untouched.
- No hook on prompts, tool calls or the transcript. Its code calls no `$.env`, `$.process`, `$.fs.write` or `$.model`.
- Two settings in `/plugin`: **Backend**, `live` (the default: Dooryard's server) or `fake` (demo cards kept in memory, no network); and **API URL**, the one https host the mod talks to when Backend is `live`, `https://dooryard-kappa.vercel.app` by default.
- Surfaces: the band above the prompt in the terminal and the desktop app, the status line in VS Code, the pane on all three. Nothing draws in `claude -p`, cloud sessions or Desktop WSL sessions.

What `claude plugin validate --strict ./plugin` prints for the module, verbatim, Claude Code 2.1.309 (0.1.4):

```text
  ❯ ./register.tsx hooks: session.start, command.run{command=dooryard}, turn.start, turn.complete, ui.close{id=yard}, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=yard}
  ❯ ./register.tsx answers its own command: command.run{command=dooryard}
  ❯ ./register.tsx gating hook without .catch: ui.close{id=yard}
  ❯ ./register.tsx calls: $.clock.after, $.clock.every, $.clock.now, $.command.register, $.http.fetch, $.session.surfaces, $.session.version (via startSignIn), $.state.get, $.state.set, $.store.delete (via signOut, signedOut), $.store.get, $.store.keys (via signOut), $.store.set (via blockHandle, pollPairing, postCard, runCommand), $.ui.close (via finish, openBand), $.ui.log, $.ui.open (via openBand, openPane), $.ui.resolve, $.ui.status (via refreshStatus), $.ui.toast
  ❯ ./register.tsx state writes: dooryard.card, dooryard.countdown, dooryard.hello, dooryard.hidden, dooryard.messages, dooryard.mode, dooryard.notices, dooryard.nudge, dooryard.pairing, dooryard.phase, dooryard.photo, dooryard.photoUrl, dooryard.problem, dooryard.server, dooryard.thread
  ❯ ./register.tsx state reads: dooryard.card, dooryard.countdown, dooryard.hello, dooryard.hidden, dooryard.messages, dooryard.mode, dooryard.notices, dooryard.nudge, dooryard.pairing, dooryard.phase, dooryard.photo, dooryard.photoUrl, dooryard.problem, dooryard.server, dooryard.thread
```

Run the command yourself on the commit you install and compare. `$.http.fetch` goes only to the API URL. `$.session.version` reads the Claude Code version string, sent once when you pair. `$.session.surfaces`, `$.state.*` and `$.store.*` stay on your machine.

## What it sends, and to whom

With Backend set to `live`, every network call goes to the API URL, `https://dooryard-kappa.vercel.app` by default, and nowhere else. Text JSON only. Polling runs only while a turn of your agent runs. Outside a turn, the mod calls Dooryard only at session start, to fetch the interface text, while the pane shows a sign-in code, and when you act in the pane.

This is the complete list of fields the mod sends:

| When | What |
|---|---|
| Every call except pairing and the interface text | Your session token |
| Session start | Nothing but the request for the interface text |
| You pair the mod (`/dooryard on`, first time) | The surface (terminal, desktop or VS Code) and the Claude Code version string; then a secret only the mod knows, until you approve the device on the sign-in page |
| A turn of your agent starts | The surface. Never the content of the turn |
| While a turn runs, every 5 seconds | The turn's id, to get the waiting count and your dealt card |
| A turn ends | The turn's id |
| You post a card | The card text (up to 80 characters) |
| You press hi | The card's id. A hello carries no text |
| You write in a thread | The text you typed, and whether you confirmed it after a "hold on" check |
| You block | The other person's handle |
| You report | The card or thread id, and the category |
| You post a photo | Only a request for a one-time link. The file goes from your browser to Dooryard on the web page, never through the mod |

Your handle is the name you choose at sign-in. Dooryard keeps your GitHub id on its server for sign-in and bans, and never shows it to anyone.

Dooryard never asks for Claude or Anthropic credentials and never calls `$.session.identity()`.

## What it reads on your machine

- No files. The mod has no `$.fs.read`.
- Its own plugin store: your on/off switch, your local blocklist and, once you sign in, your session token.
- Which Claude Code surfaces are open (`$.session.surfaces`), to draw the band or the status line in the right place.
- The Claude Code version string (`$.session.version`), sent once when you pair.
- Nothing else. No prompts, no transcript, no other files, no environment variables, no settings beyond its own two.

## Dependencies

None. `plugin/package.json` declares no dependencies and holds only the test script; there is no lockfile in `plugin/`, so nothing is installed with the mod (checked at commit bb9e058). No package launcher (`npx`, `uvx`) runs at install or at runtime.

## Safety, and what Dooryard cannot promise

Every rule runs on Dooryard's server. The mod on your machine only shows them, because anyone can edit a mod they run.

- **Adults only.** Everyone confirms they are 18 or older at sign-in. Photo cards need a one-time age check at <age-check vendor>. Dooryard keeps pass or fail, never the images.
- **Hello first.** A hello is one key and carries no text. A thread opens only when both people said hi. One hello per card, one per person per 24 hours. Unopened hellos expire after 24 hours.
- **What is not allowed.** Nothing sexual, hateful or threatening, in cards or threads. No links, selling or recruiting in cards. Full rules: https://<app domain>/rules.
- **Filter and review.** A word filter hides some messages in a folder you open on purpose, and holds others for a human. A card or thread reported by two people comes down until a human looks. A human looks at every report within 24 hours.
- **Block and leave.** b blocks a person on both sides at once. x ends a thread and blocks.
- **Photos.** Checked for nudity on upload. Location data stripped. Hosted by Dooryard.

What Dooryard cannot promise:

- **Photos are permanent.** Anyone who sees your card can save it. Dooryard cannot recall copies on other machines.
- **Threads are not private from other mods.** Claude Code runs mods in a chain. Any mod that runs before Dooryard, on your machine or on the other person's, can read and change what Dooryard sends and receives, message text included. That covers your organization's mods and other mods you installed.
- **Your organization can turn mods off.** If it does, Dooryard stays off. We will not help anyone get around it.

Intimate image of you posted without consent? Report it at https://<app domain>/takedown. We remove it within 48 hours of a valid request.

Dooryard is not made or endorsed by Anthropic.

## Privacy

Privacy policy: `https://<app domain>/privacy`.

## Report a vulnerability

Write to `security@<app domain>`. Please do not open a public issue for a security problem. We acknowledge within 2 business days.

## License

MIT. See [LICENSE](./LICENSE).

## Repository layout

- `plugin/`: the mod (manifest, hooks module, types, tests). This is everything that runs on your machine.
- `.claude-plugin/marketplace.json`: the marketplace that installs it, pinned to a commit of this repository.

Dooryard's server is a separate, private codebase. Everything the mod sends to it is listed above.
