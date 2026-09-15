import { z } from "zod";

export const reviewStartSchema = z.object({
  note: z.string().trim().max(500).optional().default(""),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(["verify", "reject"]),
  decisionReason: z.string().trim().max(1000).optional().default(""),
  overrideRisk: z.boolean().optional().default(false),
  overrideTrustGate: z.boolean().optional().default(false),
  overrideReason: z.string().trim().max(1000).optional().default(""),
}).superRefine((data, ctx) => {
  if (data.decision === "reject" && data.decisionReason.length < 10) {
    ctx.addIssue({ code: "custom", path: ["decisionReason"], message: "Rejection requires a reason of at least 10 characters" });
  }
  if ((data.overrideRisk || data.overrideTrustGate) && data.overrideReason.length < 10) {
    ctx.addIssue({ code: "custom", path: ["overrideReason"], message: "Overrides require a reason of at least 10 characters" });
  }
});

export const reviewReopenSchema = z.object({
  reason: z.string().trim().min(10, "Reopening a review requires a reason of at least 10 characters").max(1000),
});

export const operatorReviewRequestSchema = z.object({
  note: z.string().trim().min(10, "Review request note must be at least 10 characters").max(1000),
});
