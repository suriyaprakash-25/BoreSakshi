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

export const geologicalLayerSchema = z.object({
  fromFt: z.number().min(0).max(5000),
  toFt: z.number().min(0).max(5000),
  material: z.string().trim().min(1, "Layer material is required").max(80),
  notes: z.string().trim().max(240).optional().default(""),
});

export const borewellSchema = z.object({
  lat,
  lng,
  gpsAccuracyM: z.number().min(0, "GPS accuracy is required").max(5000, "GPS accuracy is implausibly large"),
  gpsCapturedAt: z.string().datetime({ offset: true }),
  drillingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "drillingDate must be YYYY-MM-DD"),
  placeName: z.string().trim().max(80).optional().default(""),
  depthFt: z.number().positive("Total depth must be greater than zero").max(5000),
  strata: z.string().trim().max(120).optional().default(""),
  geologicalLayers: z.array(geologicalLayerSchema).min(1, "At least one geological layer is required").max(20),
  waterStrikeFt: z.number().min(0).max(5000).nullable(),
  yieldLpm: z.number().min(0).max(100000).nullable(),
  success: z.boolean({ error: "success (true/false) is required" }),
  evidenceTokens: z.array(z.string().min(20).max(4096)).min(1, "At least one evidence photo is required").max(10),
  language: z.string().max(10).optional(),
}).superRefine((data, ctx) => {
  if (data.success) {
    if (!(data.waterStrikeFt > 0)) {
      ctx.addIssue({ code: "custom", path: ["waterStrikeFt"], message: "Water-strike depth is required when water is found" });
    } else if (data.waterStrikeFt > data.depthFt) {
      ctx.addIssue({ code: "custom", path: ["waterStrikeFt"], message: "Water-strike depth cannot exceed total depth" });
    }
    if (!(data.yieldLpm > 0)) {
      ctx.addIssue({ code: "custom", path: ["yieldLpm"], message: "Yield is required when water is found" });
    }
  } else {
    if (data.waterStrikeFt !== 0) {
      ctx.addIssue({ code: "custom", path: ["waterStrikeFt"], message: "Dry-hole waterStrikeFt must be 0" });
    }
    if (data.yieldLpm !== 0) {
      ctx.addIssue({ code: "custom", path: ["yieldLpm"], message: "Dry-hole yieldLpm must be 0" });
    }
  }

  let previousTo = 0;
  data.geologicalLayers.forEach((layer, index) => {
    if (layer.toFt <= layer.fromFt) {
      ctx.addIssue({ code: "custom", path: ["geologicalLayers", index, "toFt"], message: "Layer end depth must be greater than start depth" });
    }
    if (layer.toFt > data.depthFt) {
      ctx.addIssue({ code: "custom", path: ["geologicalLayers", index, "toFt"], message: "Geological layer cannot extend below total drilled depth" });
    }
    if (index > 0 && layer.fromFt < previousTo) {
      ctx.addIssue({ code: "custom", path: ["geologicalLayers", index, "fromFt"], message: "Geological layers cannot overlap" });
    }
    previousTo = Math.max(previousTo, layer.toFt);
  });
});

// admin can change an operator's status and verified flag — never role.
export const adminOperatorPatchSchema = z.object({
  status: z.enum(["active", "deactivated"]).optional(),
  verified: z.boolean().optional(),
}).refine((d) => d.status !== undefined || d.verified !== undefined, {
  message: "Nothing to update",
});

// Phase 8 keeps the existing simple admin verification toggle for compatibility.
// Phase 9 will expand this into the full SUBMITTED→UNDER_REVIEW→VERIFIED/REJECTED lifecycle.
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
