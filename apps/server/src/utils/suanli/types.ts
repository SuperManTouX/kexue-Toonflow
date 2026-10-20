import { z } from "zod";

const fieldBase = {
  name: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(128),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
};

export const suanliParamSchema = z.discriminatedUnion("ui", [
  z.object({ ...fieldBase, ui: z.literal("textarea"), maxLength: z.number().int().positive().max(20000).optional() }),
  z.object({ ...fieldBase, default: z.boolean().optional(), ui: z.literal("switch") }),
  z.object({ ...fieldBase, ui: z.literal("number"), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().positive().optional() }),
  z.object({ ...fieldBase, ui: z.literal("proportion"), options: z.array(z.string().min(1)).min(1).max(100) }),
  z.object({ ...fieldBase, ui: z.literal("hidden") }),
  z.object({
    ...fieldBase,
    ui: z.literal("dimension"),
    dimension: z.object({
      width: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).optional(),
      height: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).optional(),
      separator: z.string().min(1).max(8),
    }),
  }),
  z.object({ ...fieldBase, ui: z.enum(["dimensionWidth", "dimensionHeight"]), min: z.number().finite().optional(), max: z.number().finite().optional() }),
  z.object({ ...fieldBase, ui: z.literal("quantity"), options: z.array(z.number().finite()).min(1).max(100) }),
  z.object({ ...fieldBase, ui: z.literal("resolution"), options: z.array(z.string().min(1)).min(1).max(100) }),
  z.object({ ...fieldBase, ui: z.literal("select"), options: z.array(z.union([z.string(), z.number().finite()])).min(1).max(100) }),
  z.object({ ...fieldBase, ui: z.literal("imageUpload"), maxCount: z.number().int().positive().max(100), maxSizeMB: z.number().finite().positive().max(50).optional() }),
]);

export const suanliParamsSchema = z.array(suanliParamSchema).max(100);

export type SuanliParam = z.infer<typeof suanliParamSchema>;
export type SuanliModel = {
  providerId: "suanli";
  modelRef: string;
  modelId: string;
  label: string;
  kind: string;
  category?: string;
  platformCode: string;
  platformName: string;
  params?: SuanliParam[];
};
