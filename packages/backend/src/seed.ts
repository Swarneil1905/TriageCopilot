import "dotenv/config";
import { getPool, closePool } from "./db.js";
import { appendEvent, createPatient, getDisplayName } from "./eventStore.js";
import { PgEventLog } from "./eventLog.js";
import { runTriageAgent } from "./agents/triageAgent.js";
import { FakeProvider, ProviderTurn } from "./agents/llmProvider.js";

// All patients here are fictional, generated for demo purposes only. No
// real PHI. Names, complaints, and scores are placeholders chosen to
// exercise specific code paths (low risk / high risk / a simulated agent
// failure / an untouched fresh intake), not to represent real people.

function lowRiskScript(): ProviderTurn[] {
  return [
    { toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null },
    {
      toolCalls: [
        {
          id: "2",
          name: "flag_risk_level",
          input: {
            risk_level: "low",
            justification: "No acute risk indicators; symptoms are mild and situational.",
          },
        },
      ],
      text: null,
    },
    {
      toolCalls: [
        {
          id: "3",
          name: "draft_clinical_summary",
          input: {
            summary:
              "Patient reports mild, situational low mood and sleep disruption over several weeks. No safety concerns identified.",
            recommended_next_step: "Routine follow-up in 2 weeks; consider a brief supportive-therapy referral.",
          },
        },
      ],
      text: null,
    },
    {
      toolCalls: [
        { id: "4", name: "request_human_review", input: { reason: "Routine triage complete, low risk." } },
      ],
      text: null,
    },
  ];
}

function highRiskScript(): ProviderTurn[] {
  return [
    { toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null },
    {
      toolCalls: [
        {
          id: "2",
          name: "flag_risk_level",
          input: {
            risk_level: "high",
            justification:
              "Patient endorsed passive thoughts of not wanting to be here on intake; requires same-day clinician review.",
          },
        },
      ],
      text: null,
    },
    {
      toolCalls: [
        {
          id: "3",
          name: "draft_clinical_summary",
          input: {
            summary:
              "Patient reports passive ideation, denies any plan or intent. Elevated PHQ-9/GAD-7 scores relative to baseline.",
            recommended_next_step: "Same-day clinician safety check-in required before any further action.",
          },
        },
      ],
      text: null,
    },
    {
      toolCalls: [
        {
          id: "4",
          name: "request_human_review",
          input: { reason: "High risk flagged: needs immediate clinician attention." },
        },
      ],
      text: null,
    },
  ];
}

async function main() {
  const pool = getPool();
  const nameOf = (id: string) => getDisplayName(pool, id);

  console.log("Resetting database (all existing synthetic patients/events will be removed)...");
  await pool.query("truncate table events, patients restart identity cascade");

  console.log("Seeding 4 synthetic patients (fictional, no real PHI)...\n");

  // 1. Normal end-to-end: intake -> low-risk triage -> clinician approves -> follow-up scheduled.
  {
    const { id } = await createPatient(pool, "Alex Rivera (synthetic)");
    await appendEvent(pool, nameOf, {
      patientId: id,
      type: "IntakeFormSubmitted",
      actorType: "system",
      actorName: "intake-service",
      payload: {
        chief_complaint: "Feeling low and unmotivated for the past few weeks.",
        phq9_score: 9,
        gad7_score: 6,
      },
    });
    const log = new PgEventLog(pool, id);
    await runTriageAgent({ eventLog: log, provider: new FakeProvider({ script: lowRiskScript() }) });
    await log.append({
      type: "ClinicianDecisionRecorded",
      actorType: "clinician",
      actorName: "Dr. Priya Nair",
      payload: { decision: "approved", note: "Agree with the agent's assessment.", clinician_name: "Dr. Priya Nair" },
    });
    await log.append({
      type: "FollowUpScheduled",
      actorType: "system",
      actorName: "scheduler",
      payload: { date: "2026-09-08", method: "video" },
    });
    console.log(`  [1/4] Alex Rivera        -> ${(await log.getState()).status}`);
  }

  // 2. High risk: left at urgent_review, awaiting a clinician. Deliberately not resolved.
  {
    const { id } = await createPatient(pool, "Jordan Blake (synthetic)");
    await appendEvent(pool, nameOf, {
      patientId: id,
      type: "IntakeFormSubmitted",
      actorType: "system",
      actorName: "intake-service",
      payload: {
        chief_complaint: "Reports passive thoughts of not wanting to be here; no plan or intent.",
        phq9_score: 19,
        gad7_score: 14,
      },
    });
    const log = new PgEventLog(pool, id);
    await runTriageAgent({ eventLog: log, provider: new FakeProvider({ script: highRiskScript() }) });
    console.log(`  [2/4] Jordan Blake       -> ${(await log.getState()).status} (left for a clinician to act on)`);
  }

  // 3. Simulated transient LLM failure, recovered via retry, then completes normally.
  {
    const { id } = await createPatient(pool, "Sam Okafor (synthetic)");
    await appendEvent(pool, nameOf, {
      patientId: id,
      type: "IntakeFormSubmitted",
      actorType: "system",
      actorName: "intake-service",
      payload: {
        chief_complaint: "Trouble sleeping and increased irritability at work.",
        phq9_score: 7,
        gad7_score: 5,
      },
    });
    const log = new PgEventLog(pool, id);
    await runTriageAgent({
      eventLog: log,
      provider: new FakeProvider({ failFirstNCalls: 1, script: lowRiskScript() }),
      retryBaseDelayMs: 1,
    });
    console.log(`  [3/4] Sam Okafor         -> ${(await log.getState()).status} (one simulated LLM failure, recovered via retry)`);
  }

  // 4. Fresh / untouched: just created, no intake submitted yet.
  {
    await createPatient(pool, "Morgan Ellis (synthetic)");
    console.log(`  [4/4] Morgan Ellis       -> intake_pending (no intake submitted yet)`);
  }

  console.log("\nDone. Run `npm run backend:dev` and `npm run frontend:dev` to explore these in the dashboard.");
  await closePool();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await closePool();
  process.exit(1);
});
