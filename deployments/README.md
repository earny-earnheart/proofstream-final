# Deployments

This directory is the **audit trail** for ProofStream contract deployments. Every time `npm run deploy:sepolia` or `npm run deploy:arbitrum` is run (followed by `/verify-and-tag`), a new entry is appended to `<network>.json` in this directory.

## Schema

```json
{
  "network": "sepolia",
  "chainId": 11155111,
  "history": [
    {
      "address": "0x...",
      "txHash": "0x...",
      "blockNumber": 12345678,
      "deployer": "0x...",
      "commit": "abc1234",
      "compiledAt": "2026-05-27T12:34:56.000Z",
      "verified": true,
      "explorerUrl": "https://sepolia.etherscan.io/address/0x..."
    }
  ]
}
```

`history[]` is **append-only**. The newest deployment goes to the end. Older entries are never overwritten — they remain as the historical record.

## Files (created on first deploy)

- `sepolia.json` — written by `/verify-and-tag sepolia <address>`
- `arbitrum-sepolia.json` — written by `/verify-and-tag arbitrum <address>`

## Commit convention

**Always commit `deployments/*.json` immediately after running `/verify-and-tag`.** The on-chain bytecode is the source of truth, but this file is the canonical mapping of address ↔ git commit, which is what auditors and future operators need to reproduce a build.

Suggested commit message: `deploy(sepolia): ProofStream at 0xABCD...`

## Why this directory exists in git

Without an explicit committed file here, the `.gitignore` rules might catch JSON files and silently lose the deployment record. The `.gitkeep` ensures the directory is tracked from day one.
