# Algobot CLI Feedback

## Missing Features

### `agents create` command

- **Missing `--provider <id>`**: Cannot specify provider ID when creating an agent. The API requires `providerId` but CLI only exposes `--model` (model name string).

  Current options:
  ```
  --name, --description, --instructions, --model, --temperature, --max-tokens, --template
  ```

  Missing:
  ```
  --provider <id>    Provider authentication ID
  --publish          Auto-publish after creation
  ```

### `--hostname` behavior

- Works but requires full URL with protocol: `--hostname https://agent-studio.eu.algolia.com`
- Could auto-detect protocol or have shorthand aliases

### Profile management

- No way to set custom hostname per profile (only env presets: local/dev/staging/prod)
- `agent-studio.eu.algolia.com` doesn't map to any preset
