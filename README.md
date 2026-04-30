# sickslip-mcp

[![MCP Badge](https://lobehub.com/badge/mcp-full/akawalek-sickslip-mcp)](https://lobehub.com/mcp/akawalek-sickslip-mcp)

Model Context Protocol (MCP) server that lets Claude (and any MCP-compliant client — Cursor, Zed, Continue, etc.) verify the authenticity of a [SickSlip](https://www.sickslip.co) doctor's note directly from a conversation.

When an HR person, manager, or patient asks the assistant to verify a doctor's note, the assistant calls this server's `verify_sickslip_note` tool with the verification code printed on the note PDF. The server queries the public SickSlip verification endpoint and returns:

- **Validity status** (valid, revoked, or not found)
- **Document ID**
- **Issued date** + **absence window**
- **Physician name + NPI** (verifiable on the federal NPI Registry)
- **State of licensure**
- **Amendment flag** if the note was modified after issuance

No PHI is exposed — no patient name, no DOB, no condition. The server hits the same public endpoint employers reach via the QR code printed on every signed PDF.

---

## Installation

### Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sickslip-verify": {
      "command": "npx",
      "args": ["-y", "sickslip-mcp"]
    }
  }
}
```

Restart Claude Desktop. The tool will appear in the available tools list. Try asking: *"Can you verify SickSlip note C2D4F9EB?"*

### Claude Desktop (Windows)

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same JSON.

### Cursor

In Cursor settings → MCP → Add new server:

```json
{
  "sickslip-verify": {
    "command": "npx",
    "args": ["-y", "sickslip-mcp"]
  }
}
```

### Other MCP clients

Any MCP-compliant client that supports stdio transport. Run `npx sickslip-mcp` and connect via stdin/stdout.

---

## Usage

Once installed, ask your AI assistant any of:

- *"Verify SickSlip note 9478FE78."*
- *"Is SickSlip note c2d4f9eb-4d51-... valid?"*
- *"Check this doctor's note: [code]. What dates does it cover?"*

The assistant will call the tool and report back. Both formats are accepted — the full UUID or the short 8-character Document ID.

---

## What it returns

For a **valid note**:

> SickSlip note C2D4F9EB is VALID. Issued: 2026-04-15. Absence window: 2026-04-15 through 2026-04-17. Issued by Adam Z. Kawalek, MD (NPI 1326223306), licensed in CA. For employer questions: (877) 861-4165.

For a **revoked note**:

> This SickSlip note (Document ID: AB12CD34) was REVOKED on 2026-04-19. Revoked notes are not valid for absence documentation. Issued by Adam Z. Kawalek, MD (NPI 1326223306), licensed in FL.

For an **unknown code**:

> No active SickSlip note matches the code "FOO12345". The code may be mistyped, the note may not have been issued by SickSlip, or the note may have been rejected or never approved.

The server also includes the raw JSON response as a second content block so calling assistants can parse it programmatically.

---

## Why this exists

SickSlip is a U.S.-based asynchronous telehealth service operated by SickSlip P.A. (Florida Physician Practice Association), reviewed and signed by Dr. Adam Z. Kawalek, MD (NPI 1326223306). Every note is QR-verifiable by the recipient employer at `sickslip.co/verify/:code`.

This MCP server makes that same verification accessible from any LLM client, so:

- An HR person using Claude can verify a note without leaving the chat
- A patient curious whether their note "is real" can confirm it interactively
- An employment attorney researching a workplace dispute can pull verified facts directly

---

## Privacy & data

- The server makes a single HTTP GET request to `https://sickslip.onrender.com/api/verify/:code`
- No data is stored locally
- No telemetry collected by this MCP server
- The SickSlip API logs the verification lookup as an `employer` audit event with the request IP, the same as it does for any QR-code verification

---

## Configuration

Override the backend URL via env var (useful for staging or a self-hosted SickSlip deployment):

```bash
SICKSLIP_API_BASE=https://sickslip-staging.onrender.com npx sickslip-mcp
```

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Links

- SickSlip homepage: https://www.sickslip.co
- Physician bio (Dr. Adam Kawalek): https://www.sickslip.co/about/dr-adam-kawalek?utm_source=mcp-readme&utm_medium=ai-assistant
- NPI Registry verification: https://npiregistry.cms.hhs.gov/provider-view/1326223306
- llms.txt: https://www.sickslip.co/llms.txt
- Model Context Protocol: https://modelcontextprotocol.io
