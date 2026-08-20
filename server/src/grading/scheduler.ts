import { sweepModelGrading } from "../domain/modelGrading.js";
import type { AppContext } from "../http/app.js";

export function startModelGradingBackground(ctx: AppContext): { stop: () => void } {
  if (ctx.env.role !== "canonical" || !ctx.env.deepseekApiKey) {
    return { stop: () => {} };
  }

  const apiKey = ctx.env.deepseekApiKey;
  const timer = setInterval(async () => {
    const limitRow = ctx.db.prepare("SELECT value FROM config WHERE key = 'model_grader_daily_limit'").get() as
      | { value: string }
      | undefined;
    const dailyLimit = limitRow ? (JSON.parse(limitRow.value) as number) : 20;
    try {
      await sweepModelGrading(ctx.db, apiKey, dailyLimit);
    } catch (err) {
      console.error("model grading sweep failed:", err);
    }
  }, 5 * 60_000);

  return { stop: () => clearInterval(timer) };
}
