import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export async function callJsonTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`tool ${name} returned isError: ${firstText(result)}`);
  }
  return JSON.parse(firstText(result)) as T;
}

export function expectToolError(
  result: unknown,
): { code: string; message: string } {
  const r = result as { isError?: boolean };
  if (!r.isError) throw new Error("expected isError result");
  const body = JSON.parse(firstText(result)) as { error: { code: string; message: string } };
  return body.error;
}

function firstText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("no text content");
  return text;
}
