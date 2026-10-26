/**
 * Assistant orchestration.
 *
 * Flow for one command:
 *   1. (voice only) transcribe on-device → text
 *   2. deterministic planner
 *   3. if the deterministic planner is not confident and a local LLM is
 *      installed, ask it for a plan and validate it
 *   4. either auto-run safe actions (opt-in) or hand the plan back for the
 *      confirmation UI
 *
 * Nothing here performs I/O outside the local database and the injected
 * on-device model.
 */
import type {SqlDriver} from '../db/driver';
import type {Settings} from '../domain/types';
import {planCommand, type PlanningResult, type PlannerContext} from './planner';
import {executePlan, type AgentDeps, type ExecutionOutcome} from './executor';
import type {LocalLlm} from './llm';
import {planWithLlm} from './llm';
import {SAFE_AUTO_ACTIONS} from './types';

export interface AssistantContext extends PlannerContext {
  db: SqlDriver;
  settings: Settings;
  workdayStart: number;
  workdayEnd: number;
}

export interface PlanResponse {
  planning: PlanningResult;
  usedLlm: boolean;
  /** Why the LLM was consulted, for diagnostics in the UI. */
  note: string | null;
}

export async function planAssistantCommand(
  text: string,
  ctx: AssistantContext,
  options: {llm?: LocalLlm; allowLlm?: boolean} = {},
): Promise<PlanResponse> {
  const deterministic = planCommand(text, ctx);
  const confident =
    deterministic.kind === 'plan' && deterministic.plan.confidence >= 0.7 && !deterministic.interpretation.ambiguity;
  if (confident || !options.llm || options.allowLlm === false) {
    return {planning: deterministic, usedLlm: false, note: null};
  }
  const llmPlan = await planWithLlm(options.llm, text, ctx);
  if (!llmPlan) {
    return {
      planning: deterministic,
      usedLlm: false,
      note: 'Local model could not produce a valid plan; used the built-in parser.',
    };
  }
  return {
    planning: {kind: 'plan', plan: llmPlan, interpretation: deterministic.interpretation},
    usedLlm: true,
    note: 'Planned with the local model.',
  };
}

export interface RunResponse extends PlanResponse {
  outcome: ExecutionOutcome | null;
  autoExecuted: boolean;
}

/**
 * Plans a command and, when the user has opted in, executes it immediately if
 * every action is in the safe allow-list and nothing needs confirmation.
 */
export async function runAssistantCommand(
  text: string,
  ctx: AssistantContext,
  deps: Omit<AgentDeps, 'db' | 'timeZone' | 'clock24h' | 'workdayStart' | 'workdayEnd'>,
  options: {llm?: LocalLlm; allowLlm?: boolean} = {},
): Promise<RunResponse> {
  const response = await planAssistantCommand(text, ctx, options);
  if (response.planning.kind !== 'plan') {
    return {...response, outcome: null, autoExecuted: false};
  }
  const {plan} = response.planning;
  const safe =
    plan.actions.every(entry => SAFE_AUTO_ACTIONS.has(entry.action.type)) &&
    plan.actions.every(entry => !entry.requiresConfirmation) &&
    plan.confidence >= 0.8;
  if (!ctx.settings.autoExecuteSafeCommands || !safe) {
    return {...response, outcome: null, autoExecuted: false};
  }
  const outcome = await executePlan(plan, {
    ...deps,
    db: ctx.db,
    timeZone: ctx.timeZone,
    clock24h: ctx.clock24h,
    workdayStart: ctx.workdayStart,
    workdayEnd: ctx.workdayEnd,
  });
  return {...response, outcome, autoExecuted: true};
}

export interface VoiceTranscriber {
  transcribe(audioPath: string): Promise<{text: string; durationMs?: number}>;
}

export interface VoiceCommandResult extends RunResponse {
  transcript: string;
}

/** Push-to-talk: transcribe a finished recording, then run it as a command. */
export async function runVoiceCommand(
  audioPath: string,
  transcriber: VoiceTranscriber,
  ctx: AssistantContext,
  deps: Omit<AgentDeps, 'db' | 'timeZone' | 'clock24h' | 'workdayStart' | 'workdayEnd'>,
  options: {llm?: LocalLlm; allowLlm?: boolean} = {},
): Promise<VoiceCommandResult> {
  const result = await transcriber.transcribe(audioPath);
  const text = result.text.trim();
  if (text === '') {
    return {
      planning: {
        kind: 'unknown',
        message: 'I could not hear a command. Try again a little closer to the microphone.',
        interpretation: {
          intent: 'unknown',
          title: '',
          temporal: {
            start: ctx.now,
            end: ctx.now,
            allDay: false,
            hasDate: false,
            hasTime: false,
            recurrence: null,
            consumed: [],
            confidence: 0,
            notes: [],
          },
          priority: null,
          projectName: null,
          attendees: [],
          matchedEvent: null,
          matchedTask: null,
          matchedHabit: null,
          confidence: 0,
          ambiguity: null,
          normalized: '',
        },
      },
      usedLlm: false,
      note: null,
      outcome: null,
      autoExecuted: false,
      transcript: '',
    };
  }
  const response = await runAssistantCommand(text, ctx, deps, options);
  return {...response, transcript: text};
}
