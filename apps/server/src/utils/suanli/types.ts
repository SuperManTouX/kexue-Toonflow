import type { SuanliMediaParam, SuanliMediaTemplate } from "@toonflow/tools-scaffold/runtime";

export type SuanliModel = {
  providerId: "suanli";
  modelRef: string;
  modelId: string;
  label: string;
  kind: string;
  category?: string;
  platformCode: string;
  platformName: string;
  billingUnit?: string;
  billingMode?: string;
  unitPrice?: string | number;
  inputPrice?: string | number;
  outputPrice?: string | number;
  cacheHitPrice?: string | number;
  preFrozenAmount?: string | number;
  sortOrder?: number;
  sourceType?: string;
  tags?: string[];
};

export type { SuanliMediaParam, SuanliMediaTemplate };

export type SuanliCaptcha = {
  captchaId: string;
  captchaImage: string;
};
