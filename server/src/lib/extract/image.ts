import { readFileSync } from "node:fs";

// DeepSeek's chat completions API is documented as OpenAI-SDK-compatible.
// TODO: verify current DeepSeek vision model name/endpoint — this was written
// without a way to test against a live key. "deepseek-vl" is used as a
// placeholder for whatever DeepSeek's current vision-capable chat model is
// called; double-check against DeepSeek's docs before relying on this in
// production.
const DEEPSEEK_VISION_MODEL = "deepseek-vl";
const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export async function extractImageViaDeepSeek(filePath: string, mime: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not set — image asset extraction unavailable");
  }

  const base64 = readFileSync(filePath).toString("base64");
  const dataUri = `data:${mime};base64,${base64}`;

  const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe all text visible in this image verbatim. Return only the transcribed text." },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`DeepSeek vision request failed: ${response.status} ${response.statusText} ${body}`);
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("DeepSeek vision response did not include message content");
  }
  return text;
}
