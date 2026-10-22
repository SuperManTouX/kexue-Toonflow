import type { NodeAiModel } from "@toonflow/nodes-scaffold/nodeAi";

export function groupNodeModels<T extends Pick<NodeAiModel, "providerId" | "providerLabel">>(models: readonly T[]) {
  const suanliModels = models.filter(item => item.providerId === "suanli");
  return suanliModels.length ? [{ id: "suanli", label: "SXWZ算力", models: suanliModels }] : [];
}

export function findSuanliNodeModel<T extends Pick<NodeAiModel, "modelId" | "providerId">>(models: readonly T[], value: string) {
  return models.find(item => item.providerId === "suanli" && JSON.stringify([item.providerId, item.modelId]) === value);
}
