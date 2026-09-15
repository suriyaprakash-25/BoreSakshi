// validation.js — request validation with zod (v4). Every write route runs its
// body through a schema; unknown keys are stripped and bad input is rejected as
// a clean 400 before any handler/DB logic runs.
import { z } from "zod";
import { SOURCE_TYPES, DATASET_KINDS } from "./ingestion.js";

const password = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");
const phone = z.string().min(1, "Phone is required").max(20);

// lat/lng: must be real numbers in range. z.number() rejects non-numbers, and the
// range checks reject NaN/±Infinity, so malformed coordinates never reach a handler.
const lat = z.number().min(-90, "lat must be between -90 and 90").max(90, "lat must be between -90 and 90");
const lng = z.number().min(-180, "lng must be between -180 and 180").max(180, "lng must be between -180 and 180");

export const signupSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(80),
    phone,
    password,
    confirmPassword: z.string().max(128).optional(),
  })
  .refine((d) => d.confirmPassword == null || d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const signinSchema = z.object({
  phone,
  password: z.string().min(1, "Password is required").max(128),
});

export const predictSchema = z.object({
  lat,
  lng,
  save: z.boolean().optional(),
});

export const borewellSchema = z.object({
  lat,
  lng,
  placeName: z.string().max(80).optional(),
  depthFt: z.number().min(0).max(5000).nullable().optional(),
  strata: z.string().max(120).optional(),
  waterStrikeFt: z.number().min(0).max(5000).nullable().optional(),
  yieldLpm: z.number().min(0).max(100000).nullable().optional(),
  success: z.boolean({ error: "success (true/false) is required" }),
  language: z.string().max(10).optional(),
});

// admin can change an operator's status and verified flag — never role.
export const adminOperatorPatchSchema = z.object({
  status: z.enum(["active", "deactivated"]).optional(),
  verified: z.boolean().optional(),
}).refine((d) => d.status !== undefined || d.verified !== undefined, {
  message: "Nothing to update",
});

// admin can flag/unflag a log (with a reason) and toggle its verified badge.
export const adminLogPatchSchema = z.object({
  flagged: z.boolean().optional(),
  flagReason: z.string().max(200).optional(),
  verified: z.boolean().optional(),
}).refine((d) => d.flagged !== undefined || d.verified !== undefined, {
  message: "Nothing to update",
});

// Phase 2 ingestion provenance travels in query parameters for text/csv uploads.
export const ingestionSourceSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  sourceName: z.string().trim().min(1, "sourceName is required").max(120),
  sourceReference: z.string().trim().max(500).optional().default(""),
  license: z.string().trim().max(120).optional().default(""),
  datasetName: z.string().trim().max(160).optional().default(""),
});

export const ingestionReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewNote: z.string().trim().max(500).optional().default(""),
});

export const datasetAssetSchema = z.object({
  datasetKind: z.enum(DATASET_KINDS),
  sourceName: z.string().trim().min(1, "sourceName is required").max(160),
  sourceReference: z.string().trim().max(500).optional().default(""),
  license: z.string().trim().max(160).optional().default(""),
  storageProvider: z.enum(["s3", "gcs", "azure_blob", "local", "other"]),
  objectKey: z.string().trim().min(1, "objectKey is required").max(500),
  mediaType: z.string().trim().min(1, "mediaType is required").max(120),
  byteSize: z.number().int().min(0).max(10_000_000_000),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, "sha256 must be a 64-character hex digest"),
  spatialCoverage: z.string().trim().max(500).optional().default(""),
  temporalCoverage: z.string().trim().max(200).optional().default(""),
});

export const datasetAssetReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewNote: z.string().trim().max(500).optional().default(""),
});

// middleware factory: validate req.body against a schema, replacing it with the
// parsed/sanitised result. Returns the first human-readable message on failure.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    return res.status(400).json({ error: issue?.message || "Invalid request" });
  }
  req.body = result.data;
  next();
};
