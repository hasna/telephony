import { getDueSchedules, markScheduleRun } from "../db/schedules.js";
import { sendSms } from "./sms.js";
import { sendWhatsApp } from "./whatsapp.js";
import { makeCall } from "./voice.js";
import { generateSpeech } from "./tts.js";
import type { Schedule } from "../types/index.js";

export interface ScheduleRunResult {
  schedule_id: string;
  schedule_name: string;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function runSchedule(schedule: Schedule): Promise<ScheduleRunResult> {
  try {
    let result: unknown;

    switch (schedule.action) {
      case "send_sms":
        result = await sendSms({
          to: schedule.parameters.to as string,
          body: schedule.command,
          agent_id: schedule.agent_id || undefined,
          project_id: schedule.project_id || undefined,
        });
        break;

      case "send_whatsapp":
        result = await sendWhatsApp({
          to: schedule.parameters.to as string,
          body: schedule.command,
          agent_id: schedule.agent_id || undefined,
          project_id: schedule.project_id || undefined,
        });
        break;

      case "make_call":
        result = await makeCall({
          to: schedule.parameters.to as string,
          twiml: schedule.command,
          agent_id: schedule.agent_id || undefined,
          project_id: schedule.project_id || undefined,
        });
        break;

      case "tts":
        result = await generateSpeech({
          text: schedule.command,
          voice_id: schedule.parameters.voice_id as string | undefined,
        });
        break;

      case "custom":
      default:
        // Custom schedules execute the command string
        result = { command: schedule.command, parameters: schedule.parameters };
        break;
    }

    markScheduleRun(schedule.id);
    return { schedule_id: schedule.id, schedule_name: schedule.name, action: schedule.action, success: true, result };
  } catch (err: any) {
    markScheduleRun(schedule.id);
    return { schedule_id: schedule.id, schedule_name: schedule.name, action: schedule.action, success: false, error: err.message };
  }
}

export async function tick(): Promise<ScheduleRunResult[]> {
  const due = getDueSchedules();
  const results: ScheduleRunResult[] = [];

  for (const schedule of due) {
    const result = await runSchedule(schedule);
    results.push(result);
  }

  return results;
}

let _tickInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(intervalMs: number = 60_000): void {
  if (_tickInterval) return;
  _tickInterval = setInterval(() => {
    tick().catch(console.error);
  }, intervalMs);
}

export function stopScheduler(): void {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
}
