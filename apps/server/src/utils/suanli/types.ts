export type SuanliModel = {
  providerId: "suanli";
  modelRef: string;
  modelId: string;
  label: string;
  kind: string;
  category?: string;
  platformCode: string;
  platformName: string;
};

export type SuanliCaptcha = {
  captchaId: string;
  captchaImage: string;
};
