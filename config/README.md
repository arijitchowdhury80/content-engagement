# Configuration

Public configuration belongs here only when it is safe to publish and is not tied to a tool that
requires a root-level filename.

- `.mcp.json` stays at the repository root because the local tool runtime reads it there.
- `.env.local`, `.env.vps`, and `.env.asana` are local-only credentials and are ignored by Git.
- `.claude/settings.local.json` is local tool state and is ignored by Git.

Do not put secrets, tokens, production exports, or internal Agent Studio prompt dumps in this folder.
