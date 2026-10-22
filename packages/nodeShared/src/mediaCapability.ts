import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import type { SuanliMediaTemplate } from "@toonflow/nodes-scaffold/nodeAi";

export const mediaCapabilityTags = {
  textToImage: "文生图",
  imageToImage: "图片编辑",
  textToVideo: "文生视频",
  imageToVideo: "图生视频",
  firstLastFrame: "首尾帧",
} as const;

export type MediaCapability = keyof typeof mediaCapabilityTags;

export function supportsMediaCapability(model: Pick<NodeMediaModel, "providerId" | "tags">, capability: MediaCapability) {
  return model.providerId !== "suanli" || model.tags?.includes(mediaCapabilityTags[capability]) === true;
}

function isSuanliParamVisible(
  param: SuanliMediaTemplate["params"][number],
  paramsByName: Map<string, SuanliMediaTemplate["params"][number]>,
  values: Record<string, unknown>,
  ancestors = new Set<string>(),
): boolean {
  if (!param.showWhen) return true;
  if (ancestors.has(param.name)) return false;
  const nextAncestors = new Set(ancestors).add(param.name);
  return Object.entries(param.showWhen).every(([name, expected]) => {
    const dependency = paramsByName.get(name);
    return dependency !== undefined && dependency.ui !== "hidden" && dependency.ui !== "imageUpload"
      && isSuanliParamVisible(dependency, paramsByName, values, nextAncestors)
      && Object.is(Object.hasOwn(values, name) ? values[name] : dependency.default, expected);
  });
}

export function supportsSuanliImageReferences(
  modelRef: string,
  template: SuanliMediaTemplate,
  referenceCount: number,
  values: Record<string, unknown>,
) {
  const uploadParams = template.params.filter(param => param.ui === "imageUpload");
  if (!uploadParams.length) return referenceCount === 0;
  if (`${template.platformId}:${template.modelId}` !== modelRef || uploadParams.length !== 1) return false;
  const param = uploadParams[0]!;
  if (param.name !== "imageUrls") return false;
  const paramsByName = new Map(template.params.map(field => [field.name, field]));
  if (!isSuanliParamVisible(param, paramsByName, values)) return referenceCount === 0;
  return referenceCount <= param.maxCount
    && referenceCount <= template.maxImages
    && (!param.required || referenceCount > 0);
}
