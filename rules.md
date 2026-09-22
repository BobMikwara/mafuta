# Repository Rules

## Mandatory

- No emojis in the codebase, comments, documentation, commit messages, or UI copy.
- Refrain from purple hues in the frontend.
- Always test code before deployment.
- Prioritize modular code over mega-files.
- Never commit console.logs, debug prints, secrets, credentials, or API keys.
- Do not use em dashes.
- Use TypeScript strict mode.
- Use UTC for persisted timestamps.
- Validate every external input.
- Enforce tenant isolation server-side.
- Do not invent vendor protocols or hardware capabilities.
- Do not classify unexplained movement as theft automatically.
- Do not represent stale readings as real-time.
- Do not deploy with failing CI checks.
- Keep raw device messages restricted and protected.
- Use meaningful names and small functions.
- Update documentation when behavior or contracts change.

## Code review checklist

- Is the change modular?
- Are inputs validated?
- Are permissions enforced?
- Are tests included?
- Are errors handled?
- Are logs structured and scrubbed?
- Could duplicate or delayed messages break it?
- Could one tenant access another tenant's data?
- Does the UI show freshness and uncertainty?
- Does the change preserve future dispenser integration?
