#!/usr/bin/env node
/**
 * SickSlip MCP Server
 *
 * Model Context Protocol server that exposes a single tool to verify
 * SickSlip doctor's notes by their verification code (the QR-code value
 * printed on every signed note PDF).
 *
 * Backed by the public, rate-limited /api/verify/:code endpoint at
 * sickslip.co. No authentication required — verification is a public
 * employer-facing surface (no PHI exposed; only physician name + NPI,
 * issued date, state of licensure, and absence dates).
 *
 * Install via npm + register with your MCP client (Claude Desktop,
 * Cursor, Zed, etc.). See README for client config snippets.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

const VERIFY_ENDPOINT = process.env.SICKSLIP_API_BASE || "https://sickslip.onrender.com";
const USER_AGENT = "sickslip-mcp/0.1.0";

const server = new Server(
  {
    name: "sickslip-verify",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool registry ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "verify_sickslip_note",
      description:
        "Verify the authenticity of a SickSlip doctor's note by its verification code. " +
        "Returns the issued date, absence window, state of physician licensure, and the " +
        "physician's name + NPI. Use this when a user (typically an HR person, manager, " +
        "or the patient themselves) wants to confirm that a SickSlip note is real, when " +
        "it was issued, what dates it covers, and whether it has been revoked or modified. " +
        "Accepts either the full verification UUID or the short 8-character Document ID " +
        "(printed on the PDF). Returns no PHI — no patient name, no DOB, no condition.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "The verification code printed on the SickSlip note PDF. Either the full " +
              "UUID (e.g., 'c2d4f9eb-4d51-...') or the short 8-character Document ID " +
              "(e.g., 'C2D4F9EB'). Case-insensitive.",
            minLength: 4,
            maxLength: 64,
          },
        },
        required: ["code"],
      },
    },
  ],
}));

// ── Tool implementation ────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "verify_sickslip_note") {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${request.params.name}`
    );
  }

  const code = request.params.arguments?.code;
  if (!code || typeof code !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      "verify_sickslip_note requires a 'code' string argument"
    );
  }

  // Defense: strip whitespace and refuse anything obviously not a code.
  const cleanCode = String(code).trim();
  if (cleanCode.length < 4 || cleanCode.length > 64) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Verification code must be between 4 and 64 characters"
    );
  }
  if (!/^[A-Za-z0-9-]+$/.test(cleanCode)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Verification code may only contain letters, digits, and hyphens"
    );
  }

  let response;
  try {
    response = await fetch(
      `${VERIFY_ENDPOINT}/api/verify/${encodeURIComponent(cleanCode)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        // 10s ceiling so a slow upstream doesn't hang an MCP client.
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to reach SickSlip verification endpoint: ${err.message}`,
        },
      ],
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `SickSlip endpoint returned a non-JSON response (HTTP ${response.status})`,
        },
      ],
    };
  }

  // The /api/verify endpoint returns 404 for unknown / unapproved codes,
  // 200 with valid:true for current notes, 200 with valid:false +
  // status:'REVOKED' for revoked notes. We translate each into a tool
  // result that's natural for an LLM to read aloud.
  if (response.status === 404 || data.valid === false && data.status !== "REVOKED") {
    return {
      content: [
        {
          type: "text",
          text:
            `No active SickSlip note matches the code "${cleanCode}". ` +
            `The code may be mistyped, the note may not have been issued by SickSlip, ` +
            `or the note may have been rejected or never approved. If you believe this is ` +
            `an error, the patient or employer can reach SickSlip support at ` +
            `(877) 861-4165 or support@sickslip.co.`,
        },
      ],
    };
  }

  if (data.valid === false && data.status === "REVOKED") {
    return {
      content: [
        {
          type: "text",
          text:
            `This SickSlip note (Document ID: ${data.documentId}) was REVOKED on ` +
            `${data.revokedAt}. Revoked notes are not valid for absence documentation. ` +
            `Issued by ${data.physician?.name} (NPI ${data.physician?.npi}), licensed in ` +
            `${data.stateLicensed}. For questions, contact SickSlip support at ` +
            `${data.physician?.verificationPhone || "(877) 861-4165"}.`,
        },
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  // Valid note. Build a human-readable summary plus a structured JSON
  // companion so calling assistants can reason about either.
  const summary = [
    `SickSlip note ${data.documentId} is VALID.`,
    `Issued: ${data.issuedDate}.`,
    `Absence window: ${data.absenceDates?.start} through ${data.absenceDates?.end}.`,
    `Issued by ${data.physician?.name} (NPI ${data.physician?.npi}), licensed in ${data.stateLicensed}.`,
    data.modified
      ? `Note: this document was amended after initial issuance (${data.modifiedAt}). Current dates above reflect the amendment.`
      : null,
    `For employer questions: ${data.physician?.verificationPhone || "(877) 861-4165"}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data, null, 2) },
    ],
  };
});

// ── Boot ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
// Stay alive; stdio transport handles I/O loop. Log to stderr so MCP
// clients don't choke on stdout (which is reserved for the JSON-RPC channel).
process.stderr.write(`[sickslip-mcp] listening on stdio · backend=${VERIFY_ENDPOINT}\n`);
