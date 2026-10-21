import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getAgentConfiguredModel } from "@/utils/ai";
import type { SuanliIdentity } from "@/utils/suanli/auth";
import type { SuanliModel } from "@/utils/suanli/types";

type SuanliRuntimeBinding = {
  model: SuanliModel;
  identity: SuanliIdentity;
  token: string;
  sessionRevision: number;
};
const suanliBindings = new WeakMap<object, SuanliRuntimeBinding>();

export function getSuanliBindingForRuntime(runtime: object) {
  return suanliBindings.get(runtime);
}

export async function createAgentModel(providerId: string, modelId: string, thinkingLevel = "off") {
  const configured = await getAgentConfiguredModel(providerId, modelId);
  const { provider, model, baseUrl } = configured;
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(providerId, {
    api: provider.protocol,
    baseUrl,
    models: [{
      id: model.id, name: model.label, reasoning: thinkingLevel !== "off",
      // ACT: 仅本地供应商保留图片输入；SXWZ 首期限制为文本。
      input: "suanliBinding" in configured ? ["text"] : ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
    }],
  });
  await runtime.setRuntimeApiKey(providerId, provider.apiKey);
  if ("suanliBinding" in configured) suanliBindings.set(runtime, configured.suanliBinding);
  return { provider, model, baseUrl, runtime };
}
